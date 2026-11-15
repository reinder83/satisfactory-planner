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
  test(`the whole name of the ${kind} profile stays on the switcher, which is one line`, () => {
    open(options);
    render();
    const button = $('[data-profile-switcher]')!;
    const name = button.querySelector('.profile-switcher-name')!;
    assert.equal(name.textContent, LONG, 'the whole name, not a shortened copy');
    assert.equal(name.getAttribute('title'), LONG, 'its title names it in full');
    assert.ok(button.textContent!.startsWith(LONG), 'and it names the button');
    assert.equal(button.getAttribute('aria-label'), null, 'its own text names it');
    // PRO-5: the settings lines are in the menu, not under the name.
    assert.equal(button.querySelectorAll('br').length, 0, 'nothing follows the name');
    assert.equal(name.nextElementSibling, null);
    assert.equal(button.textContent!.trim(), LONG, 'the button is the name and nothing else');
    assert.equal($('[data-plan-settings]')!.querySelectorAll('p').length, 3);
    assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
    const item = $('#profile-switcher [role="menuitemradio"][aria-checked="true"]')!;
    assert.ok(item.textContent!.startsWith(LONG), 'the menu shows the whole name');
  });

test('a short name is the switcher’s one line, its settings lines are in the menu (PRO-5)', () => {
  open({ name: 'Main', calculated: true });
  render();
  assert.equal($('.profile-switcher-name')!.textContent, 'Main');
  assert.equal($('[data-profile-switcher]')!.textContent!.trim(), 'Main');
  assert.equal($('[data-profile-switcher]')!.querySelectorAll('br').length, 0);
  const settings = $('#profile-switcher [data-plan-settings]')!;
  assert.equal(settings.getAttribute('role'), 'group');
  assert.equal(settings.getAttribute('aria-label'), 'Plan settings');
  assert.equal(settings.querySelectorAll('p').length, 3);
  assert.ok(/purity/.test(settings.textContent!), settings.textContent!);
  assert.equal($('#profile-switcher [data-plan-settings] [role^="menuitem"]'), null, 'text only');
});

// #1355 (PRO-3 polish): a kept version's name is only "Nov 14 · backup 2", so the switcher's menu
// names the profile it is a version of; the profile the user opened keeps its own name.
test('the switcher menu names the profile a kept version belongs to', () => {
  open({
    name: 'Iron run',
    calculated: true,
    workspace: {
      saves: [
        {
          id: 's',
          name: 'World',
          activeProfile: 'p',
          profiles: [
            { id: 'p', kind: 'calculated', name: 'Iron run', completed: 0, phase: '3' },
            {
              id: 'b',
              kind: 'calculated',
              name: 'Nov 14 · backup 2',
              completed: 0,
              phase: '3',
              backupOf: 'p',
            },
          ],
        },
      ],
    },
  });
  render();
  const items = [...document.querySelectorAll('#profile-switcher [role="menuitemradio"]')].map(
    item => item.textContent!.replace(/\s+/g, ' ').trim(),
  );
  assert.ok(
    items.some(text => text.startsWith('Nov 14 · backup 2 (of Iron run)')),
    items.join('|'),
  );
  assert.ok(items.some(text => text.startsWith('Iron run') && !text.includes('(of')));
});
