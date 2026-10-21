// Co-op slice 2 (#1199): a factory's owner on the Factories page and "Mine only" there and in the
// build plan. While the factories are edited each factory has an Owner field under its name, saved
// as one `factoryGroupOwner` update when committed (a blank one meaning nobody); otherwise its
// header says "Owner: Anna", with "(you)" when that is this device's name. "Mine only" and "Your
// name" (ui/factories/MineOnly.vue, app/mine.ts) are drawn once a factory has an owner; they are
// view preferences in localStorage, never saved: with both set, the Factories page shows only the
// factories owned by "me" and their production lines, and the build plan only the steps of those
// lines. Factories without an owner, other people's and the lines in no factory are hidden.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import {
  calculated,
  setFactoryEditing,
  setFactoryFilter,
  setHideDone,
  setQuery,
  setRequiredOnly,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  ME_KEY,
  MINE_ONLY_KEY,
  reloadMine,
  setMeName,
  setMineOnly,
} from '../../public/app/mine.ts';
import { $, $$, applyUpdate, evil, generated, go, open, page, stubFetch } from './setup.ts';
import type { FactoryGroups, UpdateOp } from '../../public/types/index.ts';

const ALPHA = 'fg-alpha',
  BETA = 'fg-beta',
  NOBODY = 'fg-nobody';
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const sections = () => $$('#main .user-group').map(el => el.id.replace('section-', ''));
const rowIds = () => calculated!.stages['3']!.rows!.map(row => row.id);

// Alpha (Anna's) holds the first three lines, Beta (Bram's) the next three, Nobody's the next two,
// the rest are ungrouped.
function groupsOf(ids: string[], owners: Record<string, string> = {}): FactoryGroups {
  const group = (id: string, name: string) => ({
    id,
    name,
    ...(owners[id] ? { owner: owners[id] } : {}),
  });
  return {
    groups: [group(ALPHA, 'Alpha'), group(BETA, 'Beta'), group(NOBODY, 'Nobody’s')],
    assignments: Object.fromEntries(
      ids.flatMap((id, i) =>
        i < 3
          ? [[id, [{ group: ALPHA, rate: null }]]]
          : i < 6
            ? [[id, [{ group: BETA, rate: null }]]]
            : i < 8
              ? [[id, [{ group: NOBODY, rate: null }]]]
              : [],
      ),
    ),
  };
}

let updates: [string, UpdateOp][];
async function show(view: 'factories' | 'plan', owners: Record<string, string> = {}) {
  const plan = generated();
  const ids = plan.stages['3']!.rows!.map(row => row.id);
  const factoryGroups = groupsOf(ids, owners);
  open({
    calculated: plan,
    phase: '3',
    state: { version: Object.keys(owners).length ? 20 : 3, factoryGroups },
  });
  go(view);
  render();
  await nextTick();
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
}
const sent = () => updates.filter(([path]) => path === '/api/update').map(([, body]) => body);

beforeEach(() => {
  page();
  localStorage.removeItem(ME_KEY);
  localStorage.removeItem(MINE_ONLY_KEY);
  reloadMine();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  setHideDone(false);
  setRequiredOnly(false);
});
afterEach(() => {
  localStorage.removeItem(ME_KEY);
  localStorage.removeItem(MINE_ONLY_KEY);
  reloadMine();
  setFactoryEditing(false);
});

test('without an owner the page has no Mine only and no owner line', async () => {
  await show('factories');
  assert.equal($('[data-mine-bar]'), null);
  assert.equal($('[data-group-owner]'), null);
  assert.deepEqual(sections(), [ALPHA, BETA, NOBODY]);
});

test('while editing, each factory’s Owner field saves one update; a blank one means nobody', async () => {
  await show('factories');
  setFactoryEditing(true);
  render();
  await nextTick();
  const field = $<HTMLInputElement>(`#main [data-group-owner-input="${ALPHA}"]`)!;
  assert.equal(field.value, '');
  assert.equal(field.placeholder, 'Nobody');
  assert.equal(field.getAttribute('aria-label'), 'Owner of Alpha');
  assert.equal(field.maxLength, 40);
  field.value = ' Anna ';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(sent(), [{ type: 'factoryGroupOwner', id: ALPHA, owner: ' Anna ' }]);
  assert.equal(state.factoryGroups.groups[0]!.owner, 'Anna');
  assert.equal(state.version, 20);
  // The field shows the saved owner; a hostile owner stays text.
  assert.equal($<HTMLInputElement>(`#main [data-group-owner-input="${ALPHA}"]`)!.value, 'Anna');
  const beta = $<HTMLInputElement>(`#main [data-group-owner-input="${BETA}"]`)!;
  beta.value = evil.slice(0, 40);
  beta.dispatchEvent(new Event('input', { bubbles: true }));
  beta.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  // Done editing: the headers say who owns what.
  setFactoryEditing(false);
  render();
  await nextTick();
  assert.equal(text($(`#section-${ALPHA} [data-group-owner]`)), 'Owner: Anna');
  assert.equal(
    text($(`#section-${BETA} [data-group-owner]`)),
    'Owner: ' + evil.slice(0, 40).trim(),
  );
  assert.equal($('x-evil'), null, 'the hostile owner stays text');
  assert.equal($(`#section-${NOBODY} [data-group-owner]`), null);
  // Cleared: nobody, and back to the version before.
  setFactoryEditing(true);
  render();
  await nextTick();
  for (const id of [ALPHA, BETA]) {
    const input = $<HTMLInputElement>(`#main [data-group-owner-input="${id}"]`)!;
    input.value = '  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  assert.equal(
    state.factoryGroups.groups.some(group => 'owner' in group),
    false,
  );
  assert.equal(state.version, 3);
});

test('Mine only shows only the factories owned by “me” and their lines, nothing saved', async () => {
  await show('factories', { [ALPHA]: 'anna', [BETA]: 'Bram' });
  const ids = rowIds();
  const bar = $('[data-mine-bar]')!;
  assert.ok(bar, 'drawn once a factory has an owner');
  const box = $<HTMLInputElement>('[data-mine-only]')!;
  assert.equal(box.disabled, true, 'no name yet');
  assert.match(text($('[data-mine-note]')), /Enter your name/);
  // The name, then the switch, both remembered in this browser.
  const name = $<HTMLInputElement>('[data-me-name]')!;
  name.value = ' Anna ';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  name.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(localStorage.getItem(ME_KEY), 'Anna');
  assert.equal(text($(`#section-${ALPHA} [data-group-owner]`)), 'Owner: anna (you)');
  assert.equal(text($(`#section-${BETA} [data-group-owner]`)), 'Owner: Bram');
  const on = $<HTMLInputElement>('[data-mine-only]')!;
  assert.equal(on.disabled, false);
  on.checked = true;
  on.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(localStorage.getItem(MINE_ONLY_KEY), 'on');
  // Only Alpha: Bram's factory, the factory without an owner and the ungrouped lines are hidden.
  assert.deepEqual(sections(), [ALPHA]);
  assert.equal($$('#main .factory-card').length, 3);
  assert.ok(text($('#main .toolbar')).includes('3 production lines'));
  assert.equal($$('#main .jump-bar .btn').length, 1);
  assert.equal(
    text($('[data-mine-note]')),
    'Only the factories owned by Anna show. Factories without an owner are hidden too.',
  );
  assert.ok(!text($('#main')).includes('UNGROUPED PRODUCTION LINES'));
  assert.equal(ids.length > 8, true);
  // While editing every factory shows again, so each can get its owner.
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.deepEqual(sections(), [ALPHA, BETA, NOBODY]);
  assert.match(text($('[data-mine-note]')), /Every factory shows while you edit/);
  setFactoryEditing(false);
  // Unticked: everything again.
  render();
  await nextTick();
  const off = $<HTMLInputElement>('[data-mine-only]')!;
  off.checked = false;
  off.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(sections(), [ALPHA, BETA, NOBODY]);
  assert.equal(localStorage.getItem(MINE_ONLY_KEY), 'off');
  assert.deepEqual(sent(), [], 'Mine only and the name are never saved with the profile');
});

test('a name no factory carries leaves the page saying so', async () => {
  setMeName('Carl');
  setMineOnly(true);
  await show('factories', { [ALPHA]: 'Anna' });
  assert.deepEqual(sections(), []);
  assert.equal(
    text($('#main [data-filter-empty]')),
    'None of your factories has a production line in this phase. Untick “Mine only” to see every factory.',
  );
});

test('in the build plan Mine only keeps the steps of my factories’ lines', async () => {
  setMeName('Anna');
  await show('plan', { [ALPHA]: 'Anna', [BETA]: 'Bram' });
  const ids = rowIds();
  const all = $$('#main [data-task]').map(el => el.dataset.task!);
  assert.ok(
    all.some(id => !id.startsWith('calc-')),
    'the phase has steps in no factory',
  );
  assert.ok($('[data-mine-bar]'));
  const box = $<HTMLInputElement>('[data-mine-only]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const mine = $$('#main [data-task]').map(el => el.dataset.task!);
  assert.deepEqual(
    mine.sort(),
    ids
      .slice(0, 3)
      .map(id => 'calc-3-' + id)
      .sort(),
  );
  assert.match(
    text($('[data-mine-note]')),
    /^Only the steps of production lines in factories owned by Anna show\./,
  );
  // Ticked all three: the list says why it shows no open step.
  for (const id of ids.slice(0, 3)) state.checks['calc-3-' + id] = true;
  render();
  await nextTick();
  assert.equal(
    text($('#main [data-mine-left]')),
    'None of the open steps of this phase is in a factory you own. Untick “Mine only” to see them.',
  );
  const off = $<HTMLInputElement>('[data-mine-only]')!;
  off.checked = false;
  off.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal($$('#main [data-task]').length, all.length);
  assert.deepEqual(sent(), []);
});
