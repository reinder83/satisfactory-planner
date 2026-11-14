// The quick-jump search (#1351, X-5 and BAK-4): what it finds, the shortcut and where it must
// stay quiet, the combobox keys and ARIA, focus going back, and the jump itself.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { jumpResults } from '../../public/app/jump-index.ts';
import { calcStage } from '../../public/app/session.ts';
import { jumpShortcut, openJump } from '../../public/app/ui/jump.ts';
import { $, $$, evil, open, openMigrated, page } from './setup.ts';

const dialog = () => $<HTMLDialogElement>('#jump')!;
const input = () => $<HTMLInputElement>('[data-jump-input]')!;
const key = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
async function type(text: string) {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}
const firstRow = () => calcStage()!.rows![0]!;

beforeEach(() => {
  page();
  document.body.addEventListener('keydown', jumpShortcut);
  openMigrated();
});

test('finds a production line by name and by what it makes, and a note by its text', () => {
  const row = firstRow();
  const found = jumpResults(row.name.slice(0, 4));
  assert.ok(found.some(r => r.kind === 'line' && r.id === row.id));
  const part = Object.keys(row.outputs || {})[0];
  if (part)
    assert.ok(
      jumpResults(part).some(r => r.kind === 'line' && r.id === row.id),
      'by its part',
    );
  open({ notes: { global: 'Seed near the red swamp', 'phase-3': 'Plastic comes later' } });
  const notes = jumpResults('swamp');
  assert.deepEqual(
    notes.map(r => [r.kind, r.id]),
    [['note', 'global']],
  );
  assert.match(notes[0]!.hint, /red swamp/);
  assert.equal(jumpResults('   ').length, 0);
  assert.equal(jumpResults('zzzz-no-such-thing').length, 0);
});

test('finds a factory by name and a note on a container or a line', () => {
  const id = firstRow().id;
  open({
    state: {
      factoryGroups: { groups: [{ id: 'fg-1', name: 'Electronics' }], assignments: {} },
    } as never,
    notes: { 'slot-A01': 'Labelled in blue', ['factory-' + id]: 'Check the belt' },
  });
  assert.deepEqual(
    jumpResults('electr')
      .filter(r => r.kind === 'factory')
      .map(r => [r.kind, r.id]),
    [['factory', 'fg-1']],
  );
  assert.ok(
    jumpResults('blue').some(r => r.kind === 'note' && r.label === 'Note on container A01'),
  );
  assert.ok(jumpResults('check the belt').some(r => r.id === 'factory-' + id));
});

test('Ctrl+K and "/" open the search with focus in the box; closing puts focus back', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const event = key(opener, { key: 'k', ctrlKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(dialog().open, true);
  assert.equal(document.activeElement, input());
  dialog().close();
  assert.equal(document.activeElement, opener, 'back where it was');
  assert.equal(dialog().querySelector('input'), null, 'unmounted');
  key(opener, { key: '/' });
  assert.equal(dialog().open, true);
  dialog().close();
  key(opener, { key: 'k', metaKey: true });
  assert.equal(dialog().open, true);
});

test('the shortcut stays quiet while typing, with a dialog open, and for other keys', () => {
  const fields = [
    '<input>',
    '<textarea></textarea>',
    '<select></select>',
    '<div contenteditable="true"></div>',
  ];
  for (const html of fields) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    document.body.append(holder);
    const field = holder.firstElementChild!;
    for (const init of [{ key: '/' }, { key: 'k', ctrlKey: true }]) {
      const event = key(field, init);
      assert.equal(event.defaultPrevented, false, html + ' ' + init.key);
    }
  }
  assert.equal(document.querySelector('#jump'), null, 'never opened');
  key(document.body, { key: 'k' });
  key(document.body, { key: '/', ctrlKey: true });
  assert.equal(document.querySelector('#jump'), null);
  $<HTMLDialogElement>('#confirm')!.showModal();
  key(document.body, { key: '/' });
  assert.equal(document.querySelector('#jump'), null, 'not over another dialog');
});

test('the box is a combobox over a listbox; arrows move, Enter opens the result', async () => {
  openJump();
  assert.equal(input().getAttribute('role'), 'combobox');
  assert.equal(input().getAttribute('aria-controls'), 'jump-list');
  assert.equal(input().getAttribute('aria-expanded'), 'false');
  assert.equal($('#jump-list')!.getAttribute('role'), 'listbox');
  const row = firstRow();
  await type(row.name.slice(0, 3));
  const options = $$('#jump [role="option"]');
  assert.ok(options.length >= 1);
  assert.equal(input().getAttribute('aria-expanded'), 'true');
  assert.equal(input().getAttribute('aria-activedescendant'), options[0]!.id);
  assert.equal(options[0]!.getAttribute('aria-selected'), 'true');
  assert.match($('[data-jump-status]')!.textContent!, /result/);
  if (options.length > 1) {
    key(input(), { key: 'ArrowDown' });
    await nextTick();
    assert.equal(input().getAttribute('aria-activedescendant'), options[1]!.id);
    key(input(), { key: 'ArrowUp' });
    await nextTick();
    assert.equal(input().getAttribute('aria-activedescendant'), options[0]!.id);
  }
  await type('zzzz-no-such-thing');
  assert.equal($('[data-jump-status]')!.textContent, 'No results');
  await type(row.name);
  assert.ok($$('#jump [role="option"]').some(o => o.dataset.jumpKind === 'line'));
  key(input(), { key: 'Enter' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dialog().open, false, 'the search closed');
  assert.equal($<HTMLDialogElement>('#detail')!.open, true, 'a result opened');
});

test('a hostile note shows as text', async () => {
  open({ notes: { global: evil } });
  openJump();
  await type('x-evil');
  assert.equal(dialog().querySelector('x-evil'), null);
  assert.ok(dialog().textContent!.includes('<x-evil'));
});
