// Every page names the browser tab (#1254, WCAG 2.4.2 Page Titled) in the Docker edition; the
// Pages edition is page-titles-browser.test.ts. Before, every page kept index.html's
// "Project Assembly · Satisfactory Planner".
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { browserMode } from '../../public/browser-api.ts';
import { pageTitle } from '../../public/app/page-title.ts';
import { assertSharedTitles, firstFactoryName, pageTitles, SHARED_ROUTES } from './page-titles.ts';

test('the page title: heading, page, app; a heading that is the page name said once', () => {
  assert.equal(pageTitle('Phase 3', 'plan'), 'Phase 3 · Build plan · Satisfactory Planner');
  assert.equal(pageTitle('Factories', 'factories'), 'Factories · Satisfactory Planner');
  assert.equal(
    pageTitle('Create your factory plan', 'wizard'),
    'Create your factory plan · Satisfactory Planner',
  );
});

test('every page of the Docker edition has its own title', async () => {
  assert.equal(browserMode, false);
  const titles = await pageTitles([...SHARED_ROUTES, 'account']);
  assertSharedTitles(titles, firstFactoryName());
  assert.equal(titles.account, 'User accounts · Account · Satisfactory Planner');
});
