// The browser tab's title on every page (#1254, WCAG 2.4.2 Page Titled; public/app/page-title.ts,
// set by PageHeader.vue): the page's heading, the page and the app. Shared by page-titles.test.ts
// (the Docker edition) and page-titles-browser.test.ts (the Pages edition, whose browserMode is
// fixed before anything loads).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { flowRoute, setWizard, viewOf, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { startWizard } from '../../public/app/wizard/wizard.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { catalog, generated, go, open, page, stubFetch } from './setup.ts';

const APP = 'Satisfactory Planner';

async function show(route: string) {
  location.hash = '#' + route;
  go(viewOf(route));
  render();
  await nextTick();
  await nextTick();
}

// Opens a calculated profile with factories, visits each page and returns route → title.
export async function pageTitles(routes: string[]): Promise<Record<string, string>> {
  page();
  const plan = generated();
  const factoryGroups = defaultFactoryGroups(plan);
  open({ calculated: plan, state: { factoryGroups }, workspace: { catalog: catalog() } });
  stubFetch({ '/api/workspace': () => workspace });
  const titles: Record<string, string> = {};
  for (const route of routes) {
    await show(route === 'flow' ? flowRoute(factoryGroups.groups[0]!.id) : route);
    titles[route] = document.title;
  }
  setWizard(null);
  startWizard();
  render();
  await nextTick();
  titles.wizard = document.title;
  setWizard(null);
  return titles;
}

export const SHARED_ROUTES = [
  'plan',
  'factories',
  'flow',
  'logistics',
  'storage',
  'resources',
  'notes',
  'session',
  'backup',
  'profiles',
];

// The titles both editions give: the heading first, the page's name once, then the app.
export function assertSharedTitles(titles: Record<string, string>, factoryName: string) {
  assert.equal(titles.plan, `Phase 3 · Build plan · ${APP}`);
  assert.equal(titles.factories, `Factories · ${APP}`);
  assert.equal(titles.flow, `${factoryName} · Factories · ${APP}`);
  assert.equal(titles.logistics, `Logistics · ${APP}`);
  assert.equal(titles.storage, `Storage room · ${APP}`);
  assert.equal(titles.resources, `Power & resources · ${APP}`);
  assert.equal(titles.notes, `Notes · ${APP}`);
  assert.equal(titles.session, `Phase 3 · Today's session · ${APP}`);
  assert.equal(titles.backup, `Backup · ${APP}`);
  assert.equal(titles.profiles, `Saves & profiles · ${APP}`);
  assert.equal(titles.wizard, `Create your factory plan · ${APP}`);
  // Every page its own title.
  const all = Object.values(titles);
  assert.equal(new Set(all).size, all.length, JSON.stringify(titles, null, 1));
}

export const firstFactoryName = () => defaultFactoryGroups(generated()).groups[0]!.name;
