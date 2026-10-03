// The top bar's save name (#817, Shell.vue): style.css cuts it to one line with an ellipsis, as
// it does the profile switcher's (#792), so a long name with no spaces cannot push the phase
// track off the window. The cut is only drawn: the whole name stays the link's text (its
// accessible name) and its title. The cut itself is measured in a real browser (see the pull
// request).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { $, evil, go, open, page } from './setup.ts';

beforeEach(() => {
  page();
  go('plan');
});

for (const name of ['X'.repeat(80), 'Northern forest ' + evil])
  test(`the breadcrumb keeps the whole save name: ${name.slice(0, 20)}…`, () => {
    open({ name });
    render();
    const link = $('.breadcrumbs a')!;
    assert.equal(link.textContent, name, 'the whole name, not a shortened copy');
    assert.equal(link.getAttribute('title'), name, 'its title names it in full');
    assert.equal(link.getAttribute('aria-label'), null, 'its own text names it');
    assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
  });
