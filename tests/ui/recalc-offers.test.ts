// The plan's recalculation offers recalculate the open profile in place (#1071,
// ui/recalc-offer.ts): "Recalculate in place with items made on site", "… with exact clocks" and
// "… with transport fuel" ask first, naming the backup kept of the current version, then run the
// unsaved-notes check (allowSwitch) and send POST /api/recalculate with the plan they were made
// on. Cancelled, nothing is sent; refused as stale (409), the tab opens the plan the profile has
// now and says so. The happy paths of each offer are in exact-clocks.test.ts,
// on-site-picker.test.ts, on-site-chain.test.ts, factories.test.ts and busy.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { calculated, setFactoryEditing, setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { offerStale } from '../../public/app/ui/recalc-offer.ts';
import { $, answerConfirms, applyUpdate, evil, generated, go, open, page } from './setup.ts';
import type { FactoryGroups, StoredCalculatedPlan, UpdateOp } from '../../public/types/index.ts';

const MOTORS = 'fg-motors1';
const PLATES = 'fg-plates1';

// Motors holds the Stator and Cable lines (Wire and Steel Pipe in) and marks Wire, which the plan
// makes centrally, so the Factories page asks for a recalculation.
const groups = (): FactoryGroups => ({
  groups: [
    { id: MOTORS, name: 'Motors' },
    { id: PLATES, name: 'Plates' },
  ],
  assignments: {
    Recipe_Stator_C: [{ group: MOTORS, rate: null }],
    Recipe_Cable_C: [{ group: MOTORS, rate: null }],
    Recipe_IngotIron_C: [{ group: PLATES, rate: null }],
  },
  local: { [MOTORS]: ['Wire'] },
});
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

// Answers every request: /api/update as the server would, /api/recalculate with `recalculate`
// (a status and a body) and /api/context with the profile's plan now. Returns the paths asked.
function serve(
  recalculate: () => { status: number; body: object },
  planNow: () => StoredCalculatedPlan,
) {
  const paths: string[] = [];
  globalThis.fetch = async (path: RequestInfo | URL, options: RequestInit = {}) => {
    const url = String(path);
    paths.push(url.split('?')[0]!);
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (url.startsWith('/api/update')) return reply(200, applyUpdate(body as UpdateOp));
    if (url.startsWith('/api/recalculate')) {
      const answer = recalculate();
      return reply(answer.status, answer.body);
    }
    if (url.startsWith('/api/context'))
      return reply(200, {
        save: { id: 's', name: 'World' },
        profile: { id: 'p', kind: 'calculated', name: evil },
        state: { ...state, factoryGroups: groups() },
        plan: planNow(),
      });
    return reply(500, { error: 'unexpected ' + url });
  };
  return paths;
}

beforeEach(() => {
  page();
  setQuery('');
  setFactoryEditing(false);
  go('factories');
});

async function showFactories(plan: StoredCalculatedPlan) {
  open({ calculated: plan, state: { factoryGroups: groups() } });
  render();
  await settle();
  assert.ok($('[data-on-site-recalc]'), 'the page asks for a recalculation');
}

test('the question names the profile and the backup as text, and Cancel sends nothing', async () => {
  const plan = generated();
  await showFactories(plan);
  const paths = serve(
    () => ({ status: 500, body: { error: 'not asked' } }),
    () => plan,
  );
  const asked = answerConfirms(false);
  $<HTMLButtonElement>('[data-recalc-on-site]')!.click();
  await settle();
  assert.equal(asked.length, 1);
  assert.ok(
    asked[0]!.startsWith(`Recalculates “${evil}” with the items your factories make on site.`),
  );
  assert.match(asked[0]!, /left unticked for review/);
  assert.match(
    asked[0]!,
    /is kept as “.*\(before edit, [^”]+\)” under Profiles, with all of its progress\./,
  );
  assert.equal(document.querySelector('x-evil'), null, 'the name is text');
  assert.deepEqual(paths, [], 'nothing is sent');
  assert.ok($('[data-on-site-recalc]'), 'the notice stays');
});

test('an unsaved choice is asked about after the recalculation; keeping it sends nothing', async () => {
  const plan = generated();
  await showFactories(plan);
  setFactoryEditing(true);
  render();
  await settle();
  // Steel Pipe ticked under Motors, not saved.
  const box = $<HTMLInputElement>(
    `[data-on-site-picker="${MOTORS}"] [data-on-site-item="Steel Pipe"]`,
  )!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  const paths = serve(
    () => ({ status: 500, body: { error: 'not asked' } }),
    () => plan,
  );
  const asked = answerConfirms(question => question.startsWith('Recalculates'));
  $<HTMLButtonElement>('[data-recalc-on-site]')!.click();
  await settle();
  assert.equal(asked.length, 2, 'the recalculation, then the unsaved choice');
  assert.ok(asked[0]!.startsWith('Recalculates'));
  assert.doesNotMatch(asked[1]!, /^Recalculates/);
  assert.deepEqual(paths, [], 'nothing is recalculated or saved');
  assert.ok(box.checked, 'the choice stays on screen');
});

test('a profile recalculated meanwhile elsewhere is refused (409): the tab opens its plan now', async () => {
  const plan = generated();
  await showFactories(plan);
  // Another tab recalculated it with the marks meanwhile.
  const elsewhere: StoredCalculatedPlan = {
    ...plan,
    createdAt: '2026-10-09T12:00:00.000Z',
    settings: { ...plan.settings, onSite: onSiteSettings(plan, groups()) },
  };
  let sentPlan: unknown;
  const paths = serve(
    () => ({
      status: 409,
      body: { error: 'This profile was recalculated in another tab or on another device.' },
    }),
    () => elsewhere,
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/recalculate'))
      sentPlan = JSON.parse(String(options.body)).planCreatedAt;
    return realFetch(path, options);
  };
  answerConfirms(true);
  $<HTMLButtonElement>('[data-recalc-on-site]')!.click();
  await settle();
  await settle();
  assert.equal(sentPlan, plan.createdAt, 'the request named the plan the offer was made on');
  assert.deepEqual(paths, ['/api/recalculate', '/api/context']);
  assert.equal(calculated?.createdAt, elsewhere.createdAt, 'the plan the profile has now is open');
  assert.equal($('[data-on-site-recalc]'), null, 'which needs no recalculation');
  assert.equal($('#toast')!.textContent, offerStale);
  assert.ok($('#toast')!.classList.contains('error'));
});

test('any other refusal says why and leaves the offer as it was', async () => {
  const plan = generated();
  await showFactories(plan);
  const paths = serve(
    () => ({ status: 400, body: { error: 'This save already has 30 profiles.' } }),
    () => plan,
  );
  answerConfirms(true);
  const button = $<HTMLButtonElement>('[data-recalc-on-site]')!;
  button.click();
  await settle();
  await settle();
  assert.deepEqual(paths, ['/api/recalculate'], 'the open plan stays');
  assert.equal($('#toast')!.textContent, 'This save already has 30 profiles.');
  assert.equal(button.textContent, 'Recalculate in place with items made on site');
  assert.equal(button.getAttribute('aria-disabled'), null, 'and can be pressed again');
});
