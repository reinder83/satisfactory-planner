// The words for factories and production lines (#1046): what the code calls a factory group is a
// factory to the user, and one recipe row a production line ("line" in counts). Only the words
// changed: a progress state saved by the previous release loads as it was, with no migration,
// its own rewritten step text stays as the user wrote it, the build plan lists the same step
// ids (recorded on main before the change, tests/fixtures/step-ids-2026-10-04.json; recorded
// again on #1064, whose power model added a Residual Plastic line to Phases 3 and 5 and keeps the
// Phase 4 generators, so Phase 5 retires none), and a flow
// page's address from before #926 still routes. Then a guard: no page, panel or dialog a user
// reads still says "group" for a factory or counts factories where it means lines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { flowRoute, setFactoryEditing, setQuery, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { openSlot, storageBays } from '../../public/app/views/storage.ts';
import { validateState } from '../../public/state.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, generated, go, open, page } from './setup.ts';
import type { View } from '../../public/app/session.ts';
import type { FactoryGroups, Phase, SavedState } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const rows = plan.stages['3']!.rows!;
const WIRE = rows.find(row => row.outputs.Wire && !row.id.startsWith('amp:'))!.id;
const HOME = groups.assignments[WIRE]![0]!.group;
const OTHER = groups.groups.find(group => group.id !== HOME)!.id;

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
beforeEach(() => {
  page();
  setQuery('');
  setFactoryEditing(false);
});

test('the build plan lists the step ids recorded on main before the rename', () => {
  const recorded: Record<string, Record<string, string[]>> = JSON.parse(
    fs.readFileSync('tests/fixtures/step-ids-2026-10-04.json', 'utf8'),
  );
  for (const [label, factoryGroups] of [
    ['default groups', groups],
    ['no groups', undefined],
  ] as const)
    for (const phase of ['1', '2', '3', '4', '5', 'post'] as Phase[]) {
      page();
      open({
        calculated: structuredClone(plan),
        phase,
        state: factoryGroups ? { factoryGroups } : {},
      });
      assert.deepEqual(
        planTasks().map(task => task.id),
        recorded[label]![phase],
        `${label}, phase ${phase}`,
      );
    }
});

// Progress as the previous release saved it: factories with a split, a vehicle on a link and
// items made on site (state version 14), a ticked line, and a step whose text the user rewrote,
// using the old words.
const OWN_BODY = 'Open factory details for an easier rounded option. Belt from the factory group.';
const saved = {
  version: 14,
  revision: 3,
  settings: { phase: '3' },
  checks: { [`calc-3-${WIRE}`]: true },
  notes: { [`factory-${WIRE}`]: 'My factory note' },
  deliveries: {},
  customTasks: [],
  taskEdits: {
    order: {},
    removed: [],
    titles: { [`calc-3-${WIRE}`]: 'Wire, factory group style' },
    bodies: { [`calc-3-${WIRE}`]: OWN_BODY },
    links: {},
  },
  factoryGroups: {
    groups: groups.groups,
    assignments: {
      ...groups.assignments,
      [WIRE]: [
        { group: OTHER, rate: 30 },
        { group: HOME, rate: null },
      ],
    },
    links: { [`${HOME}:${OTHER}`]: { mode: 'train', roundTripMin: 12 } },
    local: { [HOME]: ['Copper Ingot'] },
  },
} satisfies SavedState;

test('progress saved by the previous release loads as it was and shows in the new words', async () => {
  const loaded = validateState(structuredClone(saved));
  assert.equal(loaded.version, 14, 'no new state version');
  for (const key of ['checks', 'notes', 'taskEdits', 'factoryGroups'] as const)
    assert.deepEqual(loaded[key], saved[key], key + ' unchanged');

  open({ calculated: structuredClone(plan), phase: '3', state: loaded });
  history.replaceState(null, '', '#plan');
  go('plan');
  render();
  await settle();
  const step = $(`#main details[data-task="calc-3-${WIRE}"]`)!;
  assert.equal(step.querySelector('summary')!.textContent, 'Wire, factory group style');
  assert.equal(step.querySelector('p')!.textContent, OWN_BODY, 'the user’s own words stay');
  assert.ok($<HTMLInputElement>(`#main input[data-check="calc-3-${WIRE}"]`)!.checked);
  assert.equal(
    step.querySelector('[data-step-factory]')!.getAttribute('href'),
    '#' + flowRoute(HOME, '3'),
  );
  // A generated step text uses the new words.
  const easier = [...document.querySelectorAll('#main details[data-task^="calc-3-"] p')].find(
    body => /easier rounded option/.test(body.textContent!) && body.textContent !== OWN_BODY,
  );
  assert.match(easier!.textContent!, /Open the production line for an easier rounded option\./);

  // A flow page's address from before #926 (no ?phase=) still routes, in the new words.
  location.hash = `#factories/${HOME}/flow`;
  go(viewOf(location.hash.slice(1)));
  render();
  await settle();
  assert.ok($('[data-gf-back]'), 'the flow page is shown');
  assert.equal($('#main .eyebrow')?.textContent, 'FACTORY · BUILD ORDER');
});

// Every text a user reads on the page drawn: text, and the names and hints of controls.
function readable(): string[] {
  const texts: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('script, style, svg')) continue;
    const own = [...el.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (own) texts.push(own);
    for (const attribute of ['aria-label', 'title', 'placeholder', 'label'])
      if (el.getAttribute(attribute)) texts.push(`[${attribute}] ${el.getAttribute(attribute)}`);
  }
  return texts;
}
// "group" for a factory, or factories counted where lines are meant.
const OLD_WORDS =
  /\bgroups?\b|\bgroup's\b|\bfactory groups?\b|\b\d+ factor(y|ies)\b|factory targets/i;
// The step text the user wrote in `saved`, which stays as written (the first test).
const OWN_WORDS = /factory group style|Belt from the factory group/;

test('no page, panel or dialog says "group" for a factory or counts lines as factories', async () => {
  const found = new Set<string>();
  const scan = (where: string) => {
    for (const text of readable())
      if (OLD_WORDS.test(text) && !OWN_WORDS.test(text)) found.add(`${where}: ${text}`);
  };
  const draw = async (route: string, editing = false) => {
    page();
    open({ calculated: structuredClone(plan), phase: '3', state: saved });
    setFactoryEditing(editing);
    history.replaceState(null, '', '#' + route);
    go(viewOf(route));
    render();
    await settle();
  };
  const views: View[] = ['plan', 'factories', 'logistics', 'storage', 'resources', 'notes'];
  for (const view of [...views, 'profiles', 'backup'] as View[]) {
    await draw(view);
    scan(view);
  }
  await draw('factories', true);
  scan('factories while editing');
  for (const group of groups.groups) {
    await draw(flowRoute(group.id, '3'));
    scan('flow page of ' + group.name);
  }
  await draw('plan');
  openCalculatedFactory(WIRE);
  await settle();
  scan('production line dialog');
  await draw('storage');
  const slot = storageBays()
    .flatMap(bay => bay.items)
    .find(item => item.name && rows.some(row => row.outputs[item.name!]))!;
  openSlot(slot.id);
  await settle();
  scan('container dialog');
  setFactoryEditing(false);
  assert.deepEqual([...found], []);
  // Only a build-plan step's factory link says "Open factory"; a control that opens a line's
  // dialog never calls it a factory.
  await draw('plan');
  for (const control of document.querySelectorAll('#main [data-calc-factory]'))
    assert.doesNotMatch(control.textContent!, /factory/i, control.outerHTML.slice(0, 120));
  for (const control of document.querySelectorAll('#main a, #main button'))
    if (/Open factory/.test(control.textContent!))
      assert.ok(control.hasAttribute('data-step-factory'), control.outerHTML.slice(0, 120));
});
