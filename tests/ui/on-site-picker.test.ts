// The Factories page's "Made on site" picker and its recalculation prompt (#877, part of #868):
// which items a group is offered, that only Save stores the choice (factoryLocal), that a changed
// choice marks the plan as needing a recalculation the user starts, and that nothing recalculates
// by itself (OnSitePicker.vue, OnSiteRecalc.vue, app/on-site-picker.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  calculated,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  state,
  workspace,
} from '../../public/app/session.ts';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { onSiteChange, onSiteOffers } from '../../public/app/on-site-picker.ts';
import { mutate, validateState } from '../../public/state.ts';
import { $, $$, applyUpdate, evil, generated, go, open, page, stubFetch } from './setup.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  ProgressState,
  StoredCalculatedPlan,
  UpdateOp,
} from '../../public/types/index.ts';

const MOTORS = 'fg-motors1';
const PLATES = 'fg-plates1';
const WIRE = 'Recipe_Wire_C';

// Motors holds the Stator and Cable lines (Wire and Steel Pipe in), Plates the Iron Ingot line,
// which only takes Iron Ore, a raw resource no plan row makes.
const groups = (local?: FactoryGroups['local'], name = 'Motors'): FactoryGroups => ({
  groups: [
    { id: MOTORS, name },
    { id: PLATES, name: 'Plates' },
  ],
  assignments: {
    Recipe_Stator_C: [{ group: MOTORS, rate: null }],
    Recipe_Cable_C: [{ group: MOTORS, rate: null }],
    Recipe_IngotIron_C: [{ group: PLATES, rate: null }],
  },
  ...(local ? { local } : {}),
});
// The generated plan, as calculated with `onSite` when given (only its settings change here).
function planWith(local?: FactoryGroups['local']): CurrentCalculatedPlan {
  const plan = generated();
  const onSite = onSiteSettings(plan, groups(local));
  if (onSite) plan.settings.onSite = onSite;
  return plan;
}
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const show = async (plan: StoredCalculatedPlan, progress: Partial<ProgressState> = {}) => {
  open({ calculated: plan, state: { factoryGroups: groups(), ...progress } });
  render();
  await settle();
};
const picker = (group: string) => $(`[data-on-site-picker="${group}"]`);
const box = (item: string, group = MOTORS) =>
  picker(group)!.querySelector<HTMLInputElement>(`[data-on-site-item="${item}"]`)!;
const saveButton = (group = MOTORS) => $<HTMLButtonElement>(`[data-on-site-save="${group}"]`)!;
const tick = (input: HTMLInputElement, on: boolean) => {
  input.checked = on;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const notice = () => $('[data-on-site-recalc]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
// The ADA remark with this id, if ADA has it among its lines now.
function adaSays(id: string): string {
  adaClearFault();
  for (let i = 0; i < 60; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === id) return line.text;
  }
  return '';
}
// Requests that would recalculate a plan, in either edition's API.
const RECALCULATING = ['/api/profiles', '/api/calculate', '/api/round-up', '/api/preview'];
const recalculations = (calls: [string, unknown][]) =>
  calls.filter(([path]) => RECALCULATING.some(prefix => path.startsWith(prefix)));

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test('a group is offered the items a plan row makes and one of its rows uses', () => {
  const plan = generated();
  assert.deepEqual(onSiteOffers(plan, groups(), MOTORS), ['Steel Pipe', 'Wire']);
  // Iron Ore is raw: no plan row makes it, so Plates is offered nothing.
  assert.deepEqual(onSiteOffers(plan, groups(), PLATES), []);
  assert.deepEqual(onSiteOffers(plan, groups(), 'fg-nothere1'), []);
  // A group's own line made on site is the group's: its Wire line's Copper Ingot is offered too.
  const rows = plan.stages['3'].rows!;
  const wire = rows.find(row => row.id === WIRE)!;
  const line: CalcRow = {
    ...wire,
    id: `${WIRE}:${MOTORS}`,
    onSite: { group: MOTORS, recipe: WIRE },
  };
  rows.push(line);
  assert.deepEqual(onSiteOffers(plan, groups(), MOTORS), ['Copper Ingot', 'Steel Pipe', 'Wire']);
  // A phase before the start phase is milestone-only (#759): its rows offer nothing.
  const later = generated();
  later.settings.phase = '4';
  later.stages['4'].rows = later.stages['4'].rows!.filter(row => row.id !== 'Recipe_Stator_C');
  later.stages['5'].rows = later.stages['5'].rows!.filter(row => row.id !== 'Recipe_Stator_C');
  assert.ok(!onSiteOffers(later, groups(), MOTORS).includes('Steel Pipe'), 'only phase 3 used it');
});

test('a raw resource a plan row makes is never offered, and a saved mark of one says why (#921)', async () => {
  // A Water Extractor row makes Water and the Stator line takes it: still not offered, whatever
  // the plan's budgets list, because the planner cannot make Water on site (onSitePlannable).
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const stator = rows.find(row => row.id === 'Recipe_Stator_C')!;
  stator.inputs = { ...stator.inputs, Water: 10 };
  rows.push({ ...stator, id: 'Recipe_WaterPump_C', inputs: {}, outputs: { Water: 10 } });
  delete (plan.settings as { limits?: unknown }).limits;
  assert.deepEqual(onSiteOffers(plan, groups(), MOTORS), ['Steel Pipe', 'Wire']);
  // A Water mark from an older or hand-edited save stays listed so it can be cleared, with a note
  // that it can't be made on site rather than that no line uses it.
  await show(generated(), { factoryGroups: groups({ [MOTORS]: ['Water', 'Wire'] }) });
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.ok(box('Water').checked);
  // With a space between the name and the note (#934).
  assert.match(box('Water').closest('label')!.textContent!, /Water \(can't be made on site\)$/);
  assert.doesNotMatch(box('Water').closest('label')!.textContent!, /no line here/);
  assert.doesNotMatch(box('Wire').closest('label')!.textContent!, /\(/);
});

test('the picker shows a box per offered item while editing, and the marks otherwise', async () => {
  await show(generated());
  assert.equal(picker(MOTORS), null, 'not outside edit mode');
  setFactoryEditing(true);
  render();
  await nextTick();
  const boxes = $$<HTMLInputElement>(`[data-on-site-picker="${MOTORS}"] [data-on-site-item]`);
  assert.deepEqual(
    boxes.map(input => input.dataset.onSiteItem),
    ['Steel Pipe', 'Wire'],
  );
  assert.ok(boxes.every(input => !input.checked));
  assert.equal(picker(MOTORS)!.tagName, 'FIELDSET');
  assert.equal(picker(MOTORS)!.querySelector('legend')!.textContent, 'Made on site in Motors');
  // Each box is a real checkbox inside its label, so a click on the name ticks it and Space works.
  assert.ok(boxes.every(input => input.type === 'checkbox' && input.closest('label')));
  assert.ok(picker(PLATES)!.querySelector('[data-on-site-none]'), 'Plates is offered nothing');
  assert.equal($(`[data-on-site-save="${PLATES}"]`), null);
  // An item it marks that none of its lines uses now stays listed, ticked, so it can be cleared.
  await show(generated(), { factoryGroups: groups({ [MOTORS]: ['Screws', 'Wire'] }) });
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.ok(box('Screws').checked);
  assert.match(
    box('Screws').closest('label')!.textContent!,
    /Screws \(no line here uses it now\)$/,
  );
  // Not editing: the group lists what it makes on site under its heading.
  setFactoryEditing(false);
  render();
  await nextTick();
  assert.equal(
    $(`#section-${MOTORS} [data-on-site-items]`)!.textContent!.trim(),
    // Neither mark gives it a line yet (#931); each reason its own run (#955).
    'Marked, not made on site: Screws (no line here uses it now); Wire (needs a recalculation)',
  );
});

test('ticking only changes the page; Save stores the whole list as factoryLocal', async () => {
  await show(generated());
  setFactoryEditing(true);
  render();
  await nextTick();
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  assert.equal(saveButton().disabled, true, 'nothing to save yet');
  tick(box('Wire'), true);
  tick(box('Steel Pipe'), true);
  await settle();
  assert.deepEqual(calls, [], 'a box saves nothing on change (#854, #856)');
  assert.equal(state.factoryGroups?.local, undefined);
  assert.equal(saveButton().disabled, false);
  assert.ok($('[data-on-site-unsaved]'));
  // Clearing a box again back to the saved choice leaves nothing to save.
  tick(box('Steel Pipe'), false);
  tick(box('Wire'), false);
  await nextTick();
  assert.equal(saveButton().disabled, true);
  tick(box('Wire'), true);
  await nextTick();
  saveButton().focus();
  saveButton().click();
  await settle();
  assert.deepEqual(calls, [['/api/update', { type: 'factoryLocal', id: MOTORS, items: ['Wire'] }]]);
  assert.deepEqual(state.factoryGroups?.local, { [MOTORS]: ['Wire'] });
  assert.ok(box('Wire').checked, 'drawn from the saved state');
  assert.equal(saveButton().disabled, true);
  assert.equal($('[data-on-site-unsaved]'), null);
  // Save has nothing left to do, so focus went on to the first box rather than to <body>.
  assert.equal(document.activeElement, box('Steel Pipe'));
  // A refused save keeps the choice and says so.
  stubFetch({});
  tick(box('Steel Pipe'), true);
  await nextTick();
  saveButton().click();
  await settle();
  assert.ok(box('Steel Pipe').checked);
  assert.equal(saveButton().disabled, false);
  assert.deepEqual(state.factoryGroups?.local, { [MOTORS]: ['Wire'] });
});

test('a saved change marks the plan as needing a recalculation, and recalculates nothing', async () => {
  const plan = generated();
  await show(plan);
  assert.equal($('[data-on-site-recalc]'), null, 'nothing marked, nothing to do');
  assert.equal(adaSays('on-site-pending'), '');
  setFactoryEditing(true);
  render();
  await nextTick();
  const before = JSON.stringify(calculated);
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  tick(box('Wire'), true);
  await nextTick();
  assert.equal($('[data-on-site-recalc]'), null, 'not before Save');
  saveButton().click();
  await settle();
  assert.match(notice(), /^This plan needs a recalculation\./);
  assert.match(notice(), /Now: Motors makes Wire on site\./);
  assert.match(notice(), /This plan makes everything on central lines\./);
  assert.match(notice(), /Nothing changes until you start it\./);
  assert.ok($('[data-on-site-recalc] [data-recalc-on-site]'));
  assert.equal($('[data-on-site-recalc]')!.classList.contains('warn'), true);
  assert.match(adaSays('on-site-pending'), /Nothing recalculates by itself/);
  // Only the update went out, and the open plan is the one it was.
  assert.deepEqual(recalculations(calls), []);
  assert.equal(JSON.stringify(calculated), before);
  assert.equal(calculated!.settings.onSite, undefined);
  // Opening the profile again later still only asks; it does not recalculate.
  const reopened = stubFetch({});
  await show(plan, { factoryGroups: groups({ [MOTORS]: ['Wire'] }) });
  go('plan');
  render();
  await settle();
  go('factories');
  render();
  await settle();
  assert.deepEqual(recalculations(reopened), []);
  assert.match(notice(), /Now: Motors makes Wire on site\./);
});

test('Recalculate with items made on site makes a new profile from the marks now', async () => {
  const plan = generated();
  await show(plan, { factoryGroups: groups({ [MOTORS]: ['Wire'] }) });
  let sent: { settings: StoredCalculatedPlan['settings']; carryFrom: string; name: string };
  const calls = stubFetch({
    '/api/profiles': (body: typeof sent) => {
      sent = body;
      return { saveId: 's', profileId: 'p2', reviewCount: 1, workspace };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p2', kind: 'calculated', name: 'Made on site' },
      state: { ...state, factoryGroups: groups({ [MOTORS]: ['Wire'] }) },
      plan: { ...plan, settings: sent!.settings },
    }),
  });
  $<HTMLButtonElement>('[data-recalc-on-site]')!.click();
  await settle();
  await settle();
  assert.equal(calls[0]![0], '/api/profiles');
  assert.equal(sent!.carryFrom, 'p');
  assert.equal(sent!.name, `${evil} · made on site`.slice(0, 80));
  assert.deepEqual(sent!.settings.onSite, onSiteSettings(plan, groups({ [MOTORS]: ['Wire'] })));
  assert.deepEqual(sent!.settings.onSite![MOTORS]!.items, ['Wire']);
  // Everything else is the plan's own settings.
  const { onSite: _sent, ...rest } = sent!.settings;
  assert.deepEqual(rest, plan.settings);
  assert.match($('#toast')!.textContent!, /1 completed factory checks need review/);
  // The new profile's plan has the marks, so there is nothing more to recalculate.
  assert.equal($('[data-on-site-recalc]'), null);
  assert.equal(onSiteChange(calculated!, state.factoryGroups), null);
});

test('clearing every mark asks for a plan without settings.onSite', async () => {
  const plan = planWith({ [MOTORS]: ['Wire'] });
  assert.ok(plan.settings.onSite);
  await show(plan, { factoryGroups: groups({ [MOTORS]: ['Wire'] }) });
  assert.equal($('[data-on-site-recalc]'), null, 'the plan has the marks');
  setFactoryEditing(true);
  render();
  await nextTick();
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  tick(box('Wire'), false);
  await nextTick();
  saveButton().click();
  await settle();
  assert.equal(state.factoryGroups?.local, undefined, 'the field goes with its last item');
  assert.match(notice(), /Now no group makes anything on site\./);
  assert.match(notice(), /This plan: Motors makes Wire on site\./);
  let sent: { settings: StoredCalculatedPlan['settings'] } | undefined;
  stubFetch({
    '/api/profiles': (body: typeof sent) => {
      sent = body;
      return { saveId: 's', profileId: 'p', reviewCount: 0, workspace };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'Central' },
      state,
      plan: { ...plan, settings: sent!.settings },
    }),
  });
  $<HTMLButtonElement>('[data-recalc-on-site]')!.click();
  await settle();
  await settle();
  assert.ok(sent);
  assert.equal('onSite' in sent.settings, false);
  assert.equal($('[data-on-site-recalc]'), null);
});

test('only the items are compared: shares and names do not ask for a recalculation', () => {
  const plan = planWith({ [MOTORS]: ['Wire'] });
  // A renamed group, and a share measured against another total, are the same marks.
  const renamed = groups({ [MOTORS]: ['Wire'] }, 'Motor works');
  renamed.assignments.Recipe_Stator_C = [
    { group: MOTORS, rate: 1 },
    { group: PLATES, rate: null },
  ];
  assert.equal(onSiteChange(plan, renamed), null);
  // A group that marks an item none of its rows uses gets no line, so asks for nothing.
  assert.equal(onSiteChange(generated(), groups({ [PLATES]: ['Wire'] })), null);
  // Another item does.
  const change = onSiteChange(plan, groups({ [MOTORS]: ['Steel Pipe', 'Wire'] }))!;
  assert.equal(change.now, 'Motors makes Steel Pipe and Wire on site');
  assert.equal(change.had, 'Motors makes Wire on site');
});

test('factoryLocal stores a sorted list, refuses bad input and keeps old states as they were', () => {
  const base = validateState({
    version: 3,
    settings: { phase: '3' },
    checks: {},
    notes: {},
    deliveries: {},
    customTasks: [],
    factoryGroups: groups(),
  });
  assert.ok(base.version < 14, 'no marks, no version 14');
  const marked = mutate(structuredClone(base), {
    type: 'factoryLocal',
    id: MOTORS,
    items: ['Wire', 'Screws'],
  });
  assert.deepEqual(marked.factoryGroups.local, { [MOTORS]: ['Screws', 'Wire'] });
  assert.equal(marked.version, 14);
  assert.deepEqual(marked.factoryGroups.assignments, base.factoryGroups.assignments);
  assert.deepEqual(marked.checks, base.checks);
  // An empty list drops the entry, and with the last one the field and version 14.
  const cleared = mutate(structuredClone(marked), { type: 'factoryLocal', id: MOTORS, items: [] });
  assert.equal(cleared.factoryGroups.local, undefined);
  assert.equal(cleared.version, base.version);
  for (const bad of [
    { id: 'fg-nothere1', items: ['Wire'] },
    { id: MOTORS, items: ['Unobtainium'] },
    { id: MOTORS, items: ['Wire', 'Wire'] },
    { id: MOTORS, items: 'Wire' },
    { id: MOTORS, items: [7] },
  ])
    assert.throws(
      // @ts-expect-error: refused input, as a request body may send it
      () => mutate(structuredClone(marked), { type: 'factoryLocal', ...bad }),
      /Invalid items made on site|Unknown factory group/,
      JSON.stringify(bad),
    );
});

test('a hostile group name is shown as text in the picker and the notice', async () => {
  open({
    calculated: generated(),
    state: { factoryGroups: groups({ [MOTORS]: ['Wire'] }, evil) },
  });
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal(picker(MOTORS)!.querySelector('legend')!.textContent, `Made on site in ${evil}`);
  assert.equal(saveButton().getAttribute('aria-label'), `Save made on site for ${evil}`);
  assert.match(notice(), /makes Wire on site/);
  assert.ok(notice().includes(evil));
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
});
