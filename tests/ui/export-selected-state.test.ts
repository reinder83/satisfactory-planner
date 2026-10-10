// Backup's "Export selected" in each state (#943): with no save ticked it has nothing to do, so it
// is disabled, which style.css draws as unavailable rather than as busy (a normal cursor, not the
// wait cursor, #948); with a save ticked it is ready; and only while an export runs is it busy
// (aria-disabled, app/busy.ts, #299), with the wait cursor.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, cursorOf, go, open, page, useStylesheet } from './setup.ts';

const exportButton = () => $<HTMLButtonElement>('[data-export-selected]')!;
const boxes = () => $$<HTMLInputElement>('[data-choose-save]');
const tick = (input: HTMLInputElement, on: boolean) => {
  input.checked = on;
  input.dispatchEvent(new Event('change'));
};
// The button's state in the words of the issue: unavailable (nothing chosen), busy (exporting),
// or ready, with the cursor style.css draws it with.
function look(button: HTMLButtonElement) {
  return {
    disabled: button.disabled,
    cursor: cursorOf(button),
    busy: button.getAttribute('aria-disabled') === 'true',
  };
}
const NOTHING_CHOSEN = { disabled: true, cursor: 'default', busy: false };
const READY = { disabled: false, cursor: 'pointer', busy: false };
const EXPORTING = { disabled: false, cursor: 'wait', busy: true };

beforeEach(async () => {
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  page();
  useStylesheet();
  open({
    workspace: {
      saves: [
        { id: 's', name: 'First world', activeProfile: 'original', profiles: [] },
        { id: 's2', name: 'Second world', activeProfile: 'p2', profiles: [] },
      ],
    },
  });
  go('backup');
  render();
  await nextTick();
});
afterEach(() => vi.restoreAllMocks());

test('with two saves and none ticked, Export selected is unavailable, not busy', () => {
  assert.equal(boxes().length, 2);
  assert.deepEqual(look(exportButton()), NOTHING_CHOSEN);
});

test('ticking a save makes it ready, and clearing it again unavailable', async () => {
  tick(boxes()[0]!, true);
  await nextTick();
  assert.deepEqual(look(exportButton()), READY);
  tick(boxes()[0]!, false);
  await nextTick();
  assert.deepEqual(look(exportButton()), NOTHING_CHOSEN);
});

test('Export selected is busy only while its export runs, never drawn as unavailable', async () => {
  // The export waits until the test lets it through, so the button can be seen meanwhile.
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const asked: string[] = [];
  globalThis.fetch = async (path: RequestInfo | URL) => {
    asked.push(String(path));
    if (String(path).startsWith('/api/export-saves')) await gate;
    const reply = String(path).startsWith('/api/workspace')
      ? { ...workspace }
      : { format: 'satisfactory-planner-saves', saves: [] };
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  tick(boxes()[1]!, true);
  await nextTick();
  exportButton().click();
  await vi.waitFor(() => assert.ok(asked.includes('/api/export-saves?saves=s2')));
  await nextTick();
  assert.deepEqual(look(exportButton()), EXPORTING, 'busy while it exports');
  // "Export all saves" shares the busy flag.
  assert.equal($('[data-export-saves]')!.getAttribute('aria-disabled'), 'true');
  release();
  await vi.waitFor(() => assert.match($('#toast')!.textContent!, /^1 save downloaded\.$/));
  await nextTick();
  assert.deepEqual(look(exportButton()), READY, 'the save is still ticked afterwards');
});
