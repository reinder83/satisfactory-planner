// One "This plan needs a recalculation" notice with one button, however many things changed (#1280):
// the exact clocks, the somersloop pins, the Power Shard pins and (Factories page) the items made
// on site used to stand as a notice each, one above the other (ui/plan/RecalcBanner.vue).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import {
  calculated,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  setWizard,
  state,
  workspace,
} from '../../public/app/session.ts';
import { setBeginnerMode } from '../../public/app/beginner.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteChange } from '../../public/app/on-site-picker.ts';
import {
  $,
  $$,
  answerConfirms,
  catalog,
  evil,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type {
  CurrentCalculatedPlan,
  FactoryGroups,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const BASE = {
  phase: '3',
  recipes: 'standard',
  wholeMachines: true,
  storageFromSurplus: true,
  somersloops: 40,
  amplifySloops: 20,
};
const ROD = 'Recipe_IronRod_C';
const MOTORS = 'fg-motors1';
let cache: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((cache ??= generatedWith(BASE)));
const groups = (local?: FactoryGroups['local']): FactoryGroups => ({
  groups: [{ id: MOTORS, name: 'Motors' }],
  assignments: {
    Recipe_Stator_C: [{ group: MOTORS, rate: null }],
    Recipe_Cable_C: [{ group: MOTORS, rate: null }],
  },
  ...(local ? { local } : {}),
});
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const words = (selector: string) => ($(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
// The notices on the page that say the plan needs a recalculation, and every button that offers one.
const banners = () =>
  $$('#main .notice').filter(notice => notice.textContent!.includes('needs a recalculation'));
const buttons = () =>
  $$<HTMLButtonElement>('#main button').filter(b =>
    /^Recalculate in place/.test(b.textContent!.trim()),
  );

function show(view: 'plan' | 'factories', progress = {}) {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  open({ calculated: plan(), workspace: { catalog: catalog() }, state: progress });
  go(view);
  render();
}

beforeEach(() => setWizard(null));
afterEach(() => setBeginnerMode(false));

test('Power Shard pins and Made on site pending: one notice, one button, the reasons listed', async () => {
  show('factories', {
    version: 30,
    lineClocks: { '3': { [ROD]: 250 } },
    factoryGroups: groups({ [MOTORS]: ['Wire'] }),
  });
  await settle();
  assert.ok(onSiteChange(calculated!, state.factoryGroups), 'made on site is pending');
  assert.equal(banners().length, 1, 'one notice');
  assert.equal(buttons().length, 1, 'one button');
  const notice = words('[data-recalc-banner]');
  assert.match(
    notice,
    /^This plan needs a recalculation\. Made on site changed; Power Shard pins changed\. /,
  );
  assert.match(notice, /Now: Motors makes Wire on site\./);
  assert.match(notice, /Power Shard pins changed: Iron Rod \(Phase 3\): 250%/);
  assert.equal(notice.match(/Nothing changes until you start it\./g)!.length, 1);
  assert.equal(words('[data-recalc-banner] button'), 'Recalculate in place with all 2 changes');
  // Each source's own hooks are still there: the notice's, and the button's.
  for (const hook of ['data-on-site-recalc', 'data-shard-pins-recalc'])
    assert.ok($(`[data-recalc-banner][${hook}]`), hook);
  for (const hook of ['data-recalc-on-site', 'data-recalc-shard-pins'])
    assert.ok($(`[data-recalc-banner] button[${hook}]`), hook);
  assert.equal($('[data-sloop-pins-recalc]'), null);
  assert.equal($('[data-recalc-exact-clocks]'), null);
  assert.ok($('[data-on-site-recalc] [data-recalc-on-site]'), 'the made-on-site focus path');
});

test('one recalculation applies every change, and the notice is gone afterwards', async () => {
  show('factories', {
    version: 30,
    lineClocks: { '3': { [ROD]: 250 } },
    factoryGroups: groups({ [MOTORS]: ['Wire'] }),
  });
  await settle();
  const before = calculated!;
  let sent: { settings: StoredCalculatedPlan['settings']; name: string } | undefined;
  let next: StoredCalculatedPlan | undefined;
  const calls = stubFetch({
    '/api/recalculate': (body: typeof sent) => {
      sent = body;
      // The planner takes the pin; the made-on-site settings are only put on the plan here.
      const { onSite, ...rest } = body!.settings;
      next = generatedWith(rest);
      if (onSite) next.settings.onSite = onSite;
      return {
        saveId: 's',
        profileId: 'p',
        backupId: 'b',
        reviewCount: 0,
        carriedChecks: 0,
        workspace,
      };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: evil },
      state: { ...state },
      plan: next,
    }),
  });
  const asked = answerConfirms(true);
  $<HTMLButtonElement>('[data-recalc-banner] button')!.click();
  await settle();
  await settle();
  assert.equal(asked.length, 1, 'one question for both');
  assert.match(
    asked[0]!,
    /^Recalculates “.*” with the items your factories make on site and the Power Shard pins you chose\./,
  );
  assert.equal(calls.filter(([path]) => path === '/api/recalculate').length, 1, 'one request');
  assert.deepEqual(sent!.settings.onSite![MOTORS]!.items, ['Wire']);
  assert.deepEqual(sent!.settings.lineClocks, { '3': { [ROD]: 250 } });
  assert.notEqual(calculated, before, 'the new plan is open');
  assert.equal(banners().length, 0, 'the notice is gone');
  assert.equal(buttons().length, 0);
  assert.equal($('[data-recalc-banner]'), null);
});

test('the build plan has one notice for the pins too (no made-on-site source there)', async () => {
  show('plan', {
    version: 30,
    sloopPins: { '3': { [ROD]: 4 } },
    lineClocks: { '3': { [ROD]: 250 } },
    factoryGroups: groups({ [MOTORS]: ['Wire'] }),
  });
  await settle();
  assert.equal(banners().length, 1);
  assert.equal(buttons().length, 1);
  assert.match(
    words('[data-recalc-banner]'),
    /^This plan needs a recalculation\. Somersloop pins changed; Power Shard pins changed\. /,
  );
  assert.equal($('[data-on-site-recalc]'), null, 'the build plan never asked for made on site');
  assert.ok($('button[data-recalc-sloop-pins][data-recalc-shard-pins]'));
  assert.equal(words('[data-recalc-banner] button'), 'Recalculate in place with all 2 changes');
});

test('a lone source keeps its own button label and words', async () => {
  show('plan', { version: 30, lineClocks: { '3': { [ROD]: 250 } } });
  await settle();
  assert.equal(banners().length, 1);
  assert.equal($('[data-recalc-reasons]'), null, 'no list of reasons for one');
  assert.equal(words('[data-recalc-banner] button'), 'Recalculate in place with Power Shard pins');
  assert.match(
    words('[data-recalc-banner]'),
    /^This plan needs a recalculation\. Power Shard pins changed: Iron Rod \(Phase 3\): 250% with 3 Power Shards in each machine\. Nothing changes until you start it\./,
  );
});
