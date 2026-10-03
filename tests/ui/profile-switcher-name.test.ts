// The profile switcher's name (#792, Shell.vue): style.css cuts it to one line with an
// ellipsis, so a long name cannot make the sidebar scroll at a short window. The cut is only
// drawn: the whole name stays the button's text (its accessible name) and its title, and the
// menu lists it in full. The cut itself is measured in a real browser (see the pull request).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { $, evil, go, open, page } from './setup.ts';

const LONG = "Pioneer Reinder's extraordinarily long profile name for the northern forest " + evil;

beforeEach(() => {
  page();
  go('plan');
});

// A small calculated profile, and one migrated from the handbook (open()'s default, #800).
for (const [kind, options] of [
  ['calculated', { name: LONG, calculated: true }],
  ['migrated', { name: LONG }],
] as const)
  test(`the whole name of the ${kind} profile stays on the switcher, on a line of its own`, () => {
    open(options);
    render();
    const button = $('[data-profile-switcher]')!;
    const name = button.querySelector('.profile-switcher-name')!;
    assert.equal(name.textContent, LONG, 'the whole name, not a shortened copy');
    assert.equal(name.getAttribute('title'), LONG, 'its title names it in full');
    assert.ok(button.textContent!.startsWith(LONG), 'and it names the button');
    assert.equal(button.getAttribute('aria-label'), null, 'its own text names it');
    assert.equal(button.querySelectorAll('br').length, 3, 'the settings lines follow it');
    assert.equal(
      name.nextElementSibling?.nodeName,
      'BR',
      'the first settings line starts on a line of its own',
    );
    assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
    const item = $('#profile-switcher [role="menuitemradio"][aria-checked="true"]')!;
    assert.ok(item.textContent!.startsWith(LONG), 'the menu shows the whole name');
  });

test('a short name is drawn as before, followed by its settings lines', () => {
  open({ name: 'Main', calculated: true });
  render();
  assert.equal($('.profile-switcher-name')!.textContent, 'Main');
  assert.equal($('[data-profile-switcher]')!.querySelectorAll('br').length, 3);
});
