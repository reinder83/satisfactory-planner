// The top bar's save name (#817, Shell.vue): style.css cuts it to one line with an ellipsis, as
// it does the profile switcher's (#792), so a long name with no spaces cannot push the phase
// track off the window. A name over 36 characters is also cut in the middle in the text (BP-2,
// #1338): the start and the end stay, the whole name is the link's title and accessible name.
// The cut itself is measured in a real browser (see the pull request).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { $, evil, go, open, page } from './setup.ts';

beforeEach(() => {
  page();
  go('plan');
});

for (const name of ['X'.repeat(80), 'Northern forest ' + evil])
  test(`a long save name is cut in the middle, whole in its title: ${name.slice(0, 20)}…`, () => {
    open({ name });
    render();
    const link = $('.breadcrumbs a')!;
    const cut = [...name].slice(0, 20).join('') + '…' + [...name].slice(-12).join('');
    assert.equal(link.textContent, cut, 'the middle is cut out');
    assert.equal(link.getAttribute('title'), name, 'its title names it in full');
    assert.equal(link.getAttribute('aria-label'), name, 'and so does its accessible name');
    assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
  });

test('a short save name stays whole, and the profile is a chip with its plan date (BP-2)', () => {
  open({ name: 'Short name' });
  render();
  assert.equal($('.breadcrumbs a')!.textContent, 'Short name');
  assert.equal($('.breadcrumbs a')!.getAttribute('aria-label'), null);
  const chip = $('[data-crumb-profile]')!;
  assert.ok(chip.classList.contains('crumb-profile'));
  assert.ok(chip.getAttribute('data-date'), 'the plan date is drawn after the name');
  assert.equal(chip.getAttribute('title'), chip.textContent, 'the whole name is its title');
});
