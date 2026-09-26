// The factories pages on both profile kinds (public/app/ui/pages/FactoriesPage.vue and
// CalculatedFactoriesPage.vue, with their parts in public/app/ui/factories/), and the factory
// and group build-order dialogs (public/app/ui/detail/), mounted the way the app mounts them,
// in happy-dom.
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { lanePlan } from '../../public/app/flow.ts';
import LaneAdvice from '../../public/app/ui/detail/LaneAdvice.vue';
import type { FlowModel } from '../../public/app/flow.ts';
import { beforeEach, test } from 'vitest';
import {
  openCalculatedFactory,
  openFactory,
  openGroupChain,
} from '../../public/app/factory-detail.ts';
import {
  boot,
  calcStage,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { cancelDetail, closeDetail } from '../../public/app/ui/actions.ts';
import { $, $$, evil, generated, go, open, page, stubFetch } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const plan = generated();

const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
const settle = async () => {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
};
// The dialog markup with runs of whitespace (template line breaks) as one space.
const detail = () => $('#detail')!.innerHTML.replace(/\s+/g, ' ');
const factoryIds = (sel: string) =>
  $$(`${sel} .factory-card button.name`).map(b => b.dataset.factory);

// Two groups, with Wire split between them.
const GROUPS = {
  groups: [
    { id: 'fg-cable01', name: 'Cable factory' },
    { id: 'fg-plates1', name: 'Stitched plates' },
  ],
  assignments: {
    wire: [
      { group: 'fg-cable01', rate: 300 },
      { group: 'fg-plates1', rate: null },
    ],
  },
};

// The fields of the group ops this file reads from an /api/update body.
type GroupOp = { type: UpdateOp['type'] } & Partial<
  Omit<Extract<UpdateOp, { type: 'factoryGroupAdd' }>, 'type'> &
    Omit<Extract<UpdateOp, { type: 'factoryAssign' }>, 'type'>
>;

beforeEach(() => {
  page();
  open();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  globalThis.confirm = () => true;
  go('factories');
});

test('shared sites group their outputs above the individual factory list', async () => {
  render();
  const sites = $$('#main .site-group');
  assert.equal(sites[0]!.querySelector('h2')!.textContent, 'Oil campus');
  assert.equal(sites[0]!.querySelector('.eyebrow')!.textContent, 'SHARED SITE · 2 OUTPUTS');
  assert.equal($$('#main [data-factory="plastic"]').length, 2, 'Plastic sits only in the campus');
  assert.ok(!$$('#main .site-group h2').some(h => h.textContent === 'Nuclear site'));
  assert.equal($('#main > .eyebrow')!.textContent, 'UNGROUPED FACTORIES');
  open({ phase: '5' });
  render();
  await nextTick();
  assert.ok($$('#main .site-group h2').some(h => h.textContent === 'Nuclear site'));
  assert.ok($('#main [data-factory="uranium-fuel-rod"]'));
  $<HTMLInputElement>('#factory-search')!.value = 'plastic';
  $('#factory-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.deepEqual(
    $$('#main .site-group h2').map(h => h.textContent),
    ['Oil campus'],
    'a site with no match disappears',
  );
  assert.equal($('#main > .eyebrow'), null, 'so does the ungrouped label');
  assert.equal($('#main .empty-state'), null, 'no empty state while a site still matches');
  $<HTMLInputElement>('#factory-search')!.value = 'no-such-part';
  $('#factory-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal($('#main .empty-state')!.textContent, 'No factories match this filter.');
});

test('the status filter and the Running boxes work on the saved factory checks', async () => {
  open({ state: { checks: { 'factory-3-wire': true } } });
  render();
  assert.equal($<HTMLInputElement>('[data-check="factory-3-wire"]')!.checked, true);
  assert.ok(
    $('[data-check="factory-3-wire"]')!.closest('.factory-card')!.classList.contains('done'),
  );
  $<HTMLSelectElement>('#factory-filter')!.value = 'done';
  $('#factory-filter')!.dispatchEvent(new Event('change'));
  await nextTick();
  assert.deepEqual(factoryIds('#main'), ['wire']);
  assert.equal($('#main .toolbar .muted')!.textContent, '1 targets');
  $<HTMLSelectElement>('#factory-filter')!.value = 'todo';
  $('#factory-filter')!.dispatchEvent(new Event('change'));
  await nextTick();
  assert.ok(!factoryIds('#main').includes('wire'));
});

test('post-game lists the completion modules with their own checks', () => {
  open({ phase: 'post' });
  render();
  const modules = $$('#main .completion-item');
  assert.ok(modules.length > 0);
  assert.match(modules[0]!.querySelector('input')!.dataset.check!, /^completion-/);
  assert.match(modules[0]!.textContent, /Inputs:/);
  // The last machine is named only when it runs below 100%.
  assert.doesNotMatch(
    $(`[data-check="completion-portable-miner"]`)!.closest('.completion-item')!.querySelector('p')!
      .textContent,
    /last at/,
  );
  assert.match(
    $(`[data-check="completion-fabric"]`)!.closest('.completion-item')!.querySelector('p')!
      .textContent,
    /· last at 33[.,]33%/,
  );
});

test('groups show their share of a split factory, and edit mode offers the editor', async () => {
  open({ state: { factoryGroups: structuredClone(GROUPS) } });
  render();
  const groups = $$('#main .user-group');
  assert.deepEqual(
    groups.map(g => g.querySelector('h2')!.textContent),
    ['Cable factory', 'Stitched plates'],
  );
  assert.equal(groups[0]!.querySelector('.eyebrow')!.textContent, 'FACTORY GROUP · 1 FACTORY');
  assert.match(groups[0]!.querySelector('.allocation')!.textContent, /^Here: 300\/min of /);
  assert.match(groups[1]!.querySelector('.allocation')!.textContent, /^Remaining here: /);
  assert.ok(!factoryIds('#main > .cards').includes('wire'), 'a grouped factory leaves the list');
  assert.equal($('[data-group-chain]'), null, 'a one-factory group has no build order');
  $('[data-toggle-factory-edit]')!.click();
  await nextTick();
  assert.equal($('[data-toggle-factory-edit]')!.textContent.trim(), 'Done editing');
  assert.ok($('#add-group'));
  assert.equal($<HTMLInputElement>('[data-group-rename="fg-cable01"]')!.value, 'Cable factory');
  assert.equal(
    $<HTMLInputElement>('[data-assign-rate="wire"][data-group="fg-cable01"]')!.value,
    '300',
  );
  assert.ok($('[data-unassign="wire"][data-group="fg-plates1"]'));
  assert.ok($('[data-assign-add="computer"]'), 'every card offers a group');
});

test('the group editor saves groups and memberships', async () => {
  const calls = stubFetch<GroupOp>({ '/api/update': () => state });
  open({ state: { factoryGroups: structuredClone(GROUPS) } });
  setFactoryEditing(true);
  render();
  const form = $<HTMLFormElement>('#add-group')!;
  form.querySelector('input')!.value = evil;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(calls.at(-1)![1].type, 'factoryGroupAdd');
  assert.equal(calls.at(-1)![1].name, evil);
  assert.match(calls.at(-1)![1].id!, /^fg-[0-9a-f]{12}$/);
  assert.equal(form.querySelector('input')!.value, '', 'the form empties after adding');
  const rename = $<HTMLInputElement>('[data-group-rename="fg-cable01"]')!;
  rename.value = 'Cables';
  rename.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryGroupRename',
    id: 'fg-cable01',
    name: 'Cables',
  });
  const rate = $<HTMLInputElement>('[data-assign-rate="wire"][data-group="fg-cable01"]')!;
  rate.value = '120';
  rate.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryAssign',
    key: 'wire',
    groups: [
      { group: 'fg-cable01', rate: 120 },
      { group: 'fg-plates1', rate: null },
    ],
  });
  const count = calls.length;
  rate.value = '-4';
  rate.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(calls.length, count, 'an invalid rate is not saved');
  assert.equal(rate.value, '300', 'and shows the saved rate again');
  assert.match($('#toast')!.textContent, /Enter a rate above 0/);
  $('[data-unassign="wire"][data-group="fg-plates1"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1].groups, [{ group: 'fg-cable01', rate: 300 }]);
  const add = $<HTMLSelectElement>('[data-assign-add="computer"]')!;
  add.value = 'fg-plates1';
  add.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryAssign',
    key: 'computer',
    groups: [{ group: 'fg-plates1', rate: null }],
  });
  assert.equal(add.value, '', 'the selector goes back to its prompt');
  $('[data-remove-group="fg-plates1"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'factoryGroupRemove', id: 'fg-plates1' });
  globalThis.confirm = () => false;
  const before = calls.length;
  $('[data-remove-group="fg-cable01"]')!.click();
  await settle();
  assert.equal(calls.length, before, 'a declined confirmation removes nothing');
});

test('group names are escaped on the page, in the editor and in the build order', async () => {
  open({
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-a', name: evil }],
        assignments: {
          wire: [{ group: 'fg-a', rate: null }],
          cable: [{ group: 'fg-a', rate: null }],
        },
      },
      notes: { 'factory-computer': evil },
    },
  });
  render();
  noMarkup();
  assert.equal($('.user-group h2')!.textContent, evil);
  $('[data-group-chain="fg-a"]')!.click();
  await nextTick();
  assert.equal($('#detail h2')!.textContent, evil);
  noMarkup();
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>('[data-group-rename="fg-a"]')!.value, evil);
  assert.equal($('[data-assign-add="computer"] option:last-child')!.textContent, evil);
  noMarkup();
  openFactory('computer');
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, evil);
  noMarkup();
});

test('a handbook factory dialog shows its flow, destinations and local inputs', () => {
  render();
  openFactory('wire');
  assert.ok($<HTMLDialogElement>('#detail')!.open);
  assert.match(detail(), /Delivers · Phase 3/);
  assert.match(detail(), /Machines per delivery/, 'delivery rows show machine counts');
  assert.ok($('#detail .rail-link[data-factory="cable"]'), 'consumers link to their factory');
  assert.match(detail(), /Storage refill/);
  openFactory('screws');
  assert.match(detail(), /only refills the protected storage/, 'no consumers says so');
  openFactory('smart-plating');
  assert.ok($('#detail [data-factory="modular-engine"]'));
  assert.doesNotMatch(detail(), /only refills the protected storage/);
  openFactory('modular-engine');
  assert.match(detail(), /Space Elevator delivery/);
  openFactory('reinforced-iron-plate');
  assert.match(detail(), /Local: ≈ 47 × Constructor at this site/);
  assert.ok($('#detail [data-factory="wire"]'));
  assert.match(detail(), /Recipe · Stitched Iron Plate/);
  assert.match(detail(), /Belts &amp; pipes/);
  assert.equal($('#detail [data-save-note]')!.dataset.saveNote, 'factory-reinforced-iron-plate');
  open({ phase: '5' });
  openFactory('uranium-fuel-rod');
  assert.match(detail(), /nuclear power fleet/, 'nuclear items point at the power plan');
  assert.doesNotMatch(detail(), /only refills the protected storage/);
});

test('the oil campus replaces the lane advice for Plastic and Rubber', () => {
  render();
  openFactory('plastic');
  assert.match(detail(), /179 shared campus buildings/, 'expansion counts the shared campus');
  assert.match(detail(), /\+1[.,]242/, 'campus growth shows as added buildings');
  assert.match(detail(), /Campus inputs/);
  assert.match(detail(), /Fuel Generators/, 'the Phase 3 fuel byproduct feeds the generators');
  assert.doesNotMatch(detail(), /Belts &amp; pipes/);
  open({ phase: '4' });
  openFactory('rubber');
  assert.match(detail(), /Seeding the loops/);
});

test('a dialog keeps an unsaved note while a box in it is ticked', async () => {
  render();
  openFactory('wire');
  $<HTMLTextAreaElement>('#detail-note')!.value = 'Unsaved thought';
  $('#detail-note')!.dispatchEvent(new Event('input'));
  // What toggleCheck (ui/actions.ts) does once the tick is saved.
  state.checks['factory-3-wire'] = true;
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>('#detail [data-check="factory-3-wire"]')!.checked, true);
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, 'Unsaved thought');
  openFactory('wire');
  assert.equal(
    $<HTMLTextAreaElement>('#detail-note')!.value,
    '',
    'opening the dialog again starts from the saved note',
  );
});

test('belt advice counts no extra lane at an exact multiple of the capacity', () => {
  // Two lanes' worth exactly, then a little over one lane.
  const advice = (rate: number) => {
    const plan = lanePlan(rate, false, '3');
    const model: FlowModel = {
      stage: '3',
      equivalent: 4,
      machineCount: 4,
      inputs: [{ name: 'Iron Ore', rate, link: null, plan, local: null }],
      outputs: [],
      machineName: '',
      local: false,
      recipe: null,
      bar: null,
      sameItemConsumers: () => [],
    };
    const el = document.createElement('div');
    createApp({ render: () => h(LaneAdvice, { model }) }).mount(el);
    return { cap: plan.lane.cap, text: el.querySelector('.logi-row p')!.textContent!.trim() };
  };
  const { cap } = advice(1);
  // A hair under the multiple, as a solver value can be, is still every lane full (#88).
  assert.match(advice(2 * cap * (1 - 1e-10)).text, /all 2 full\.$/);
  assert.match(advice(2 * cap).text, /→ 2 × Mk\.\d belts — all 2 full\.$/);
  // A hair over the multiple needs a third lane, which carries almost nothing (#89).
  assert.match(
    advice(2 * cap + 0.001).text,
    /3 × Mk\.\d belts — 2 full \+ 1 carrying under 0\.01\/min\.$/,
  );
  assert.match(advice(cap + 30).text, /→ 2 × Mk\.\d belts — 1 full \+ 1 carrying 30\/min\.$/);
});

test('closing or replacing a dialog asks before dropping an unsaved note', () => {
  render();
  openFactory('wire');
  let asked = 0;
  globalThis.confirm = () => (asked++, false);
  $<HTMLTextAreaElement>('#detail-note')!.value = 'Unsaved thought';
  const dialog = $<HTMLDialogElement>('#detail')!;
  // The × and a backdrop click (closeDetail), another factory's link, and Escape.
  closeDetail();
  openFactory('screws');
  const escape = new Event('cancel', { cancelable: true });
  cancelDetail(escape);
  assert.equal(asked, 3);
  assert.equal(escape.defaultPrevented, true);
  assert.ok(dialog.open, 'kept notes keep the dialog open');
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, 'Unsaved thought');
  assert.equal($('#detail [data-save-note]')!.dataset.saveNote, 'factory-wire');
  globalThis.confirm = () => true;
  closeDetail();
  assert.equal(dialog.open, false);
  // Without an edit there is nothing to ask.
  globalThis.confirm = () => (asked++, false);
  openFactory('wire');
  closeDetail();
  assert.equal(dialog.open, false);
  assert.equal(asked, 3);
});

test('a handbook dialog names an underclocked last building only when there is one', () => {
  const sentence = () =>
    $$('#detail p.small.muted')
      .map(p => p.textContent.replace(/\s+/g, ' '))
      .find(t => t.includes('whole building'))!;
  render();
  openFactory('circuit-board');
  assert.match(sentence(), /32 whole buildings\. All at 100%\. Peak/);
  openFactory('smart-plating');
  assert.match(sentence(), /58 whole buildings\. All at 100%, except the last at 50%\. Peak/);
  // One building is one, not "1 whole buildings" (#112).
  openFactory('versatile-framework');
  assert.match(sentence(), /^1 whole building at 100%\. Peak/);
});

test('the calculated factories page shows its rows, round-up offer and warnings', async () => {
  const p = generated();
  p.stages['3'].feasible = false;
  p.stages['3'].reason = evil;
  open({ calculated: p });
  render();
  noMarkup();
  const rows = p.stages['3'].rows!;
  assert.equal($$('#main .factory-card').length, rows.length);
  assert.equal($('#main .toolbar span')!.textContent, rows.length + ' production lines');
  assert.ok($('[data-round-up]'), 'without whole machines it offers rounding up');
  assert.match($('#main .notice:not(.blue)')!.textContent, /Planning draft/);
  const first = rows[0]!;
  assert.equal($<HTMLInputElement>(`[data-check="calc-3-${first.id}"]`)!.checked, false);
  $<HTMLInputElement>('#factory-search')!.value = first.name;
  $('#factory-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.ok($$('#main .factory-card').length >= 1);
  assert.ok($$('#main .factory-card').length < rows.length);
});

test('a calculated factory dialog shows its flow, setup and expansion', () => {
  open({ calculated: plan });
  render();
  const x = calcStage()!;
  const r = x.rows!.find(r =>
    Object.keys(r.outputs).some(n => x.rows!.some(o => o.id !== r.id && o.inputs[n])),
  )!;
  openCalculatedFactory(r.id);
  assert.equal($('#detail h2')!.textContent, r.name);
  assert.match(detail(), /Delivers · /);
  assert.ok($('#detail [data-calc-factory]'));
  assert.match(detail(), /Machine setup/);
  assert.match(detail(), /Expansion by phase/);
  assert.equal($('#detail [data-save-note]')!.dataset.saveNote, 'factory-' + r.id);
});

test('a group build order stages suppliers before consumers', () => {
  const x = plan.stages['3'];
  const consumer = x.rows!.find(r =>
    x.rows!.some(o => o.id !== r.id && Object.keys(o.outputs || {}).some(n => r.inputs?.[n])),
  )!;
  const supplier = x.rows!.find(
    o => o.id !== consumer.id && Object.keys(o.outputs || {}).some(n => consumer.inputs[n]),
  )!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-test01', name: 'Chain test' }],
        assignments: {
          [consumer.id]: [{ group: 'fg-test01', rate: null }],
          [supplier.id]: [{ group: 'fg-test01', rate: null }],
        },
      },
    },
  });
  render();
  assert.ok($('[data-group-chain="fg-test01"]'), 'the group offers its build order');
  openGroupChain('fg-test01');
  assert.match($('#detail .eyebrow')!.textContent, /build order/);
  const names = $$('#detail .chain-title .rail-link').map(b => b.textContent);
  assert.deepEqual(names, [supplier.name + ' ↗', consumer.name + ' ↗'], 'supplier first');
  assert.ok($('#detail .chain-title [data-calc-factory]'), 'stages link to their dialogs');
  assert.match(detail(), /Needs/);
  assert.match(detail(), /Feeds/);
  assert.match(detail(), /stage 1/, 'the consumer names the stage that supplies it');
});

test('a dialog left open when the session ends closes with the sign-in screen', async () => {
  render();
  openFactory('wire');
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  // boot() after an ended session: /api/workspace answers with no user.
  stubFetch({ '/api/workspace': { user: null, accountsEnabled: true, saves: [] } });
  await boot();
  assert.ok($('#auth-form'), 'the sign-in screen is up');
  assert.equal($<HTMLDialogElement>('#detail')!.open, false, 'no dialog over it');
});
