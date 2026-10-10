// A bare disabled button is drawn as unavailable (#948): dimmed, with a normal cursor. Only a busy
// control, which is aria-disabled and never disabled (app/busy.ts, #299), gets the wait cursor.
// Before, style.css drew every disabled button with the wait cursor, so each button with nothing
// to do needed a `.unavailable` marker, and two shipped without it (#939, #943). The marker is
// gone: every disabled button of the app's pages is drawn the same way without it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $$, cursorOf, generated, go, open, page, useStylesheet } from './setup.ts';
import type { View } from '../../public/app/session.ts';

beforeEach(() => {
  page();
  useStylesheet();
});
afterEach(() => setFactoryEditing(false));

const drawn = (el: Element) => {
  const style = getComputedStyle(el);
  return { cursor: style.cursor, opacity: style.opacity };
};

test('a disabled button is dimmed with a normal cursor; a busy one with the wait cursor', () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<button id="nothing" class="btn" disabled>Save</button>' +
      '<button id="busy" class="btn" aria-disabled="true">Save</button>' +
      '<button id="ready" class="btn">Save</button>' +
      '<input id="busy-field" aria-disabled="true" />',
  );
  assert.deepEqual(drawn(document.getElementById('nothing')!), {
    cursor: 'default',
    opacity: '0.6',
  });
  assert.deepEqual(drawn(document.getElementById('busy')!), { cursor: 'wait', opacity: '0.6' });
  assert.equal(cursorOf(document.getElementById('ready')!), 'pointer');
  assert.deepEqual(drawn(document.getElementById('busy-field')!), {
    cursor: 'wait',
    opacity: '0.6',
  });
});

// The pages whose buttons can have nothing to do: Backup's Export selected with nothing ticked,
// the Factories page's edit mode (each line's Add with no factory picked, each "Made on site"
// Save with nothing to save). The storage room's are checked in storage.test.ts.
async function show(view: View, editing = false) {
  page();
  setQuery('');
  setFactoryFilter('all');
  go(view);
  const plan = generated();
  open({
    calculated: plan,
    state: { factoryGroups: defaultFactoryGroups(plan) },
    workspace: {
      saves: [
        { id: 's', name: 'First world', activeProfile: 'p', profiles: [] },
        { id: 's2', name: 'Second world', activeProfile: 'p2', profiles: [] },
      ],
    },
  });
  setFactoryEditing(editing);
  render();
  await nextTick();
  return $$<HTMLButtonElement>('#main button:disabled');
}

test('every disabled button of a page is drawn as having nothing to do, without a marker', async () => {
  const seen: string[] = [];
  for (const [view, editing] of [
    ['backup', false],
    ['factories', true],
  ] as const) {
    const disabled = await show(view, editing);
    assert.ok(disabled.length > 0, `${view} has a disabled button`);
    for (const button of disabled) {
      const name = `${view}: ${button.getAttribute('aria-label') || button.textContent!.trim()}`;
      seen.push(name);
      assert.equal(button.getAttribute('aria-disabled'), null, `${name} is not busy`);
      assert.equal(cursorOf(button), 'default', `${name} has no wait cursor`);
      assert.equal(button.classList.contains('unavailable'), false, `${name} needs no marker`);
    }
  }
  assert.ok(seen.some(name => name.startsWith('backup: Export selected')));
  assert.ok(seen.some(name => name.startsWith('factories: Save made on site')));
});

// The marker and its rule are gone for good: no component sets it, and style.css has no rule
// for it, so the next disabled button cannot miss it.
test('no component or style rule uses the retired .unavailable marker', () => {
  const vueFiles = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap(entry =>
        entry.isDirectory()
          ? vueFiles(path.join(dir, entry.name))
          : entry.name.endsWith('.vue')
            ? [path.join(dir, entry.name)]
            : [],
      );
  const marked = vueFiles('public/app/ui').filter(file =>
    /class="[^"]*\bunavailable\b|\bunavailable:|'unavailable'/.test(fs.readFileSync(file, 'utf8')),
  );
  assert.deepEqual(marked, []);
  assert.doesNotMatch(fs.readFileSync('public/style.css', 'utf8'), /\.unavailable\b/);
});
