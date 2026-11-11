// Recipe preferences (ONB-1, #1328): the picker's sticky toolbar (search, state filter with
// "Changed"), groups folded by default with a summary, opening on a search or filter, and the
// per-group bulk actions with their Undo. The picker's states are tested in wizard.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, catalog, generated, go, open, page } from './setup.ts';

// jsdom has no layout: a ResizeObserver that hands its callbacks to the test, and a toolbar that
// is 184.2px tall (four wrapped rows on a phone), stand in for the browser.
const observers: (() => void)[] = [];
class FakeResizeObserver {
  constructor(callback: () => void) {
    observers.push(callback);
  }
  observe() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains('alt-toolbar') ? 184.2 : 0;
  },
});

const RIP = 'Recipe_Alternate_ReinforcedIronPlate_2_C',
  CAST = 'Recipe_Alternate_Screw_C',
  STEEL = 'Recipe_Alternate_Screw_2_C',
  WIRE = 'Recipe_Alternate_Wire_1_C',
  PURE = 'Recipe_Alternate_PureIronIngot_C';
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const stateOf = (id: string) => $(`[data-alt-row="${id}"]`)!.dataset.altState;
const group = (product: string) => $(`[data-alt-group="${product}"]`)!;
const toggle = (product: string) => group(product).querySelector<HTMLElement>('[data-alt-toggle]')!;
const body = (product: string) => group(product).querySelector<HTMLElement>('.alt-group-body')!;
const visibleRows = () => $$('.alt-row:not([hidden])').map(row => row.dataset.altRow);
async function type(value: string) {
  const box = $<HTMLInputElement>('#alt-filter')!;
  box.value = value;
  box.dispatchEvent(new Event('input'));
  await settle();
}
async function pick(selector: string, value: string) {
  const el = $<HTMLSelectElement>(selector)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}
async function press(selector: string) {
  $<HTMLElement>(selector)!.click();
  await settle();
}
async function unfold(product: string) {
  if (toggle(product).getAttribute('aria-expanded') === 'false')
    await press(`[data-alt-group="${product}"] [data-alt-toggle]`);
}
async function force(id: string) {
  const star = $<HTMLInputElement>(`input[name=altpref][value="${id}"]`)!;
  star.checked = true;
  star.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}
const starred = (id: string) => $<HTMLInputElement>(`input[name=altpref][value="${id}"]`)!.checked;

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  page();
  setWizard({
    step: 2,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: {
      ...structuredClone(generated().settings),
      recipes: 'custom',
      alternateRecipes: [RIP],
      ownedAlternates: [WIRE],
      mamRecipes: true,
    },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  } as Parameters<typeof setWizard>[0]);
  go('wizard');
  render();
});

test('every group starts folded and says what is in it', () => {
  const groups = $$('[data-alt-group]');
  assert.ok(groups.length > 3);
  for (const g of groups) {
    const button = g.querySelector<HTMLElement>('[data-alt-toggle]')!;
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.getAttribute('aria-expanded'), 'false', g.dataset.altGroup);
    const folded = g.querySelector<HTMLElement>('.alt-group-body')!;
    assert.equal(folded.hidden, true);
    assert.equal(button.getAttribute('aria-controls'), folded.id, 'the button names what it folds');
  }
  const screws = group('Screws').querySelectorAll('.alt-row').length;
  assert.equal(
    text('[data-alt-group="Screws"] [data-alt-toggle]').replace(/^[▸▾] ?/, ''),
    `Screws · ${screws} alternates · 0 owned`,
  );
  assert.match(text('[data-alt-group="Wire"] [data-alt-toggle]'), /· 1 owned/);
  assert.match(text('[data-alt-group="Reinforced Iron Plate"] [data-alt-toggle]'), /· 1 hunting$/);
});

test('a group opens and folds by its button', async () => {
  await press('[data-alt-group="Screws"] [data-alt-toggle]');
  assert.equal(toggle('Screws').getAttribute('aria-expanded'), 'true');
  assert.equal(body('Screws').hidden, false);
  assert.equal(body('Wire').hidden, true, 'the others stay folded');
  await press('[data-alt-group="Screws"] [data-alt-toggle]');
  assert.equal(body('Screws').hidden, true);
});

test('searching by recipe name or output part opens the groups with a match', async () => {
  await type('cast');
  assert.ok(visibleRows().includes(CAST) && !visibleRows().includes(RIP));
  assert.equal(body('Screws').hidden, false, 'the group with the match is open');
  assert.equal(toggle('Screws').getAttribute('aria-expanded'), 'true');
  assert.equal(group('Wire').hidden, true, 'a group with no match is hidden');
  await type('reinforced iron plate');
  assert.ok(visibleRows().includes(RIP), 'the output part matches');
  assert.equal(body('Reinforced Iron Plate').hidden, false);
  assert.match(text('[data-alt-matches]'), /^\d+ recipes? in \d+ groups?$/);
  await type('');
  assert.equal(body('Screws').hidden, true, 'folded again with no search');
});

test('"Pure Iron Ingot" is found with one search', async () => {
  await type('Pure Iron Ingot');
  assert.ok(visibleRows().includes(PURE));
  assert.equal(body('Iron Ingot').hidden, false);
  assert.equal($$('[data-alt-group]:not([hidden])').length, 1, 'one group is left, and it is open');
});

test('a group folded by hand stays folded until the search changes', async () => {
  await type('screw');
  await press('[data-alt-group="Screws"] [data-alt-toggle]');
  assert.equal(body('Screws').hidden, true, 'a matching group can be folded');
  await type('cast screw');
  assert.equal(body('Screws').hidden, false, 'a new search opens it again');
});

test('the state filter shows All, Owned, Hunting, Not allowed and Changed', async () => {
  const all = $$('.alt-row').length;
  await pick('[data-alt-only]', 'owned');
  assert.deepEqual(visibleRows(), [WIRE]);
  assert.equal(body('Wire').hidden, false, 'its group is open');
  await pick('[data-alt-only]', 'hunting');
  assert.deepEqual(visibleRows(), [RIP]);
  await pick('[data-alt-only]', 'off');
  assert.ok(!visibleRows().includes(RIP) && !visibleRows().includes(WIRE));
  assert.ok(visibleRows().includes(CAST));
  await pick('[data-alt-only]', 'changed');
  assert.deepEqual(visibleRows().sort(), [RIP, WIRE].sort(), 'not allowed is the default');
  await pick('[data-alt-only]', '');
  assert.equal(visibleRows().length, all);
  assert.equal(body('Screws').hidden, true);
});

test('"Changed" counts a forced recipe and drops a row put back to the default', async () => {
  await press(`[data-alt-row="${CAST}"] input[data-alt-set=hunting]`);
  await force(CAST);
  await pick('[data-alt-only]', 'changed');
  assert.ok(visibleRows().includes(CAST));
  await press(`[data-alt-row="${CAST}"] input[data-alt-set=off]`);
  assert.ok(!visibleRows().includes(CAST), 'not allowed and not forced is the default again');
});

test('All owned and All not allowed change one group, and Undo puts it back', async () => {
  const rows = [...group('Screws').querySelectorAll<HTMLElement>('.alt-row')].map(
    row => row.dataset.altRow!,
  );
  await press(`[data-alt-row="${STEEL}"] input[data-alt-set=hunting]`);
  const before = rows.map(stateOf);
  await unfold('Screws');
  await press('[data-alt-group="Screws"] [data-alt-bulk=owned]');
  for (const id of rows) assert.equal(stateOf(id), 'owned', id);
  assert.equal(stateOf(RIP), 'hunting', 'other groups are not touched');
  assert.equal(stateOf(WIRE), 'owned');
  assert.match(text('#toast'), /^Marked \d+ Screws recipes owned/);
  assert.match(text('[data-alt-group="Screws"] [data-alt-toggle]'), /· \d+ owned/);
  await press('#toast [data-toast-action]');
  assert.deepEqual(rows.map(stateOf), before, 'Undo puts every row back as it was');
  await unfold('Screws');
  await press('[data-alt-group="Screws"] [data-alt-bulk=off]');
  for (const id of rows) assert.equal(stateOf(id), 'off', id);
  assert.equal(stateOf(RIP), 'hunting');
  await press('#toast [data-toast-action]');
  assert.deepEqual(rows.map(stateOf), before);
});

test('a bulk action applies to the rows the search shows, and Undo brings back a star', async () => {
  await press(`[data-alt-row="${CAST}"] input[data-alt-set=hunting]`);
  await force(CAST);
  await type('cast');
  await unfold('Screws');
  await press('[data-alt-group="Screws"] [data-alt-bulk=off]');
  assert.equal(stateOf(CAST), 'off');
  assert.equal(starred(CAST), false);
  await press('#toast [data-toast-action]');
  assert.equal(stateOf(CAST), 'hunting');
  assert.equal(starred(CAST), true, 'the star too');
  await unfold('Screws');
  await press('[data-alt-group="Screws"] [data-alt-bulk=owned]');
  await type('');
  assert.equal(stateOf(STEEL), 'off', 'a row the search hid was never touched');
});

test('the search and filters are labelled', () => {
  assert.equal($('.alt-toolbar')!.getAttribute('role'), 'search');
  for (const selector of ['#alt-filter', '[data-alt-only]', '[data-alt-phase]']) {
    const control = $<HTMLElement>(selector)!;
    assert.ok(control.closest('label')?.textContent?.trim(), selector + ' has a visible label');
  }
});

test('the toolbar height is measured and handed to the rows below it (#1358)', () => {
  const picker = $<HTMLElement>('.alt-picker')!;
  assert.ok(observers.length > 0, 'the toolbar is watched');
  for (const callback of observers) callback();
  assert.equal(
    picker.style.getPropertyValue('--alt-toolbar-h'),
    '185px',
    'the measured height, rounded up, on the element that holds the list',
  );
  assert.ok(picker.contains($('.alt-toolbar')) && picker.contains($('.alt-list')));
});
