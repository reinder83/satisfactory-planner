// "Today's session" (#1073, #session, ui/pages/SessionPage.vue) on the default plan's Phase 3: the
// next open builds in the order the build plan lists its unfinished steps, each with what it takes
// to build, its power, its raw resources and whether what feeds it runs; their materials together;
// and a To-Do note of at most 256 characters with a Copy button. How many builds it lists is a
// view preference in this browser. Nothing is ticked, stored or recalculated by the page.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { sessionSize, setSessionSize, state, type View } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, evil, generated, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, Phase, ProgressState } from '../../public/types/index.ts';

let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generated()));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function show(
  progress: Partial<ProgressState> = {},
  route: View = 'session',
  phase: Phase = '3',
) {
  open({ calculated: plan(), phase, state: progress });
  go(route);
  render();
  await nextTick();
}

// The production lines' own steps the build plan lists unfinished, in its order.
async function openLineSteps(progress: Partial<ProgressState> = {}): Promise<string[]> {
  await show(progress, 'plan');
  return $$<HTMLInputElement>('.checklist [data-check]')
    .filter(box => !box.checked && box.dataset.check!.startsWith('calc-3-'))
    .map(box => box.dataset.check!);
}
const sessionIds = () => $$('[data-session-build]').map(build => build.dataset.sessionBuild!);

beforeEach(() => {
  page();
  setSessionSize(4);
});
afterEach(() => setSessionSize(4));

test('the build plan links to today’s session', async () => {
  await show({}, 'plan');
  assert.equal($('[data-session-link]')!.getAttribute('href'), '#session');
});

test('the session lists the next open builds in the build plan’s order', async () => {
  const expected = (await openLineSteps()).slice(0, 4);
  assert.equal(expected.length, 4);
  page();
  await show();
  assert.deepEqual(sessionIds(), expected);
  // Each build says what it takes to build, its power and whether what feeds it runs.
  for (const build of $$('[data-session-build]')) {
    assert.match(text(build.querySelector('[data-session-to-build]')), /^\d+ [A-Z].* \+ Mk\.4 /);
    assert.match(text(build.querySelector('[data-session-parts]')), /^\d+ × /);
    assert.match(text(build.querySelector('[data-session-power]')), /^(Draws|Makes) /);
    assert.ok(['ready', 'after', 'waiting'].includes(build.dataset.sessionReady!));
  }
  assert.match(text($('[data-session-total]')), /^All together To build \d+ /);
  assert.match(
    text($('[data-session-later]')),
    /^\d+ more builds after these in the build plan\.$/,
  );
});

test('ticked builds leave the session, and the next ones come in', async () => {
  const all = await openLineSteps();
  const progress = { checks: Object.fromEntries(all.slice(0, 2).map(id => [id, true])) };
  page();
  await show(progress);
  assert.deepEqual(sessionIds(), all.slice(2, 6));
  assert.deepEqual(state.checks, progress.checks, 'the page ticked nothing');
});

test('a build waits on a line not marked running outside the session', async () => {
  // Iron Plate's Iron Ingot line, removed from the build plan and not marked running.
  await show({
    version: 3,
    taskEdits: {
      order: {},
      removed: ['calc-3-Recipe_IngotIron_C'],
      titles: {},
      bodies: {},
      links: {},
    },
  });
  const plate = $('[data-session-build="calc-3-Recipe_IronPlate_C"]')!;
  assert.equal(plate.dataset.sessionReady, 'waiting');
  assert.equal(
    text(plate.querySelector('[data-session-inputs]')),
    'Waiting on lines not marked running: Iron Ingot.',
  );
  // Iron Ingot running: Iron Plate is ready, and Iron Rod too.
  page();
  await show({ checks: { 'calc-3-Recipe_IngotIron_C': true } });
  for (const id of ['calc-3-Recipe_IronPlate_C', 'calc-3-Recipe_IronRod_C']) {
    const build = $(`[data-session-build="${id}"]`)!;
    assert.equal(build.dataset.sessionReady, 'ready');
    assert.equal(
      text(build.querySelector('[data-session-inputs]')),
      'Ready: what feeds it already runs or is mined.',
    );
  }
});

test('a build waits for one before it in the session', async () => {
  await show();
  const [first, plate] = $$('[data-session-build]');
  assert.equal(first!.dataset.sessionBuild, 'calc-3-Recipe_IngotIron_C');
  assert.match(text(first!.querySelector('[data-session-raw]')), /^Iron Ore [\d.,]+\/min$/);
  assert.equal(plate!.dataset.sessionReady, 'after');
  assert.equal(text(plate!.querySelector('[data-session-inputs]')), 'Ready once build 1 runs.');
});

test('with mining per phase, a build drawing raw resources waits on the open mining step', async () => {
  open({ calculated: generatedWith({ phaseMining: true }), phase: '3', state: {} });
  go('session');
  render();
  await nextTick();
  const first = $('[data-session-build="calc-3-Recipe_IngotIron_C"]')!;
  assert.equal(first.dataset.sessionReady, 'waiting');
  assert.equal(
    text(first.querySelector('[data-session-inputs]')),
    'Its raw resources wait on the open step “Tap the resource nodes”.',
  );
});

test('the To-Do note fits the game’s 256 characters and copies', async () => {
  await show();
  const note = $<HTMLTextAreaElement>('[data-session-note]')!.value;
  assert.ok([...note].length <= 256, `${[...note].length} characters`);
  assert.match(note, /^Phase 3: 1\) /);
  assert.equal(
    text($('[data-session-note-length]')),
    `For the game's To-Do list: ${[...note].length} of 256 characters.`,
  );
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => void copied.push(value) },
  });
  $('[data-session-copy]')!.click();
  await nextTick();
  await Promise.resolve();
  assert.deepEqual(copied, [note]);
  assert.equal(text($('#toast')), 'To-Do note copied.');
});

test('how many builds it lists is a view preference in this browser, not saved', async () => {
  await show();
  assert.equal(sessionIds().length, 4);
  const select = $<HTMLSelectElement>('[data-session-size]')!;
  select.value = '3';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  assert.equal(sessionIds().length, 3);
  assert.equal(sessionSize, 3);
  assert.equal(localStorage.getItem('planner-session-size'), '3');
  assert.equal(Object.keys(state.checks).length, 0, 'nothing saved with the profile');
  setSessionSize(9);
  assert.equal(sessionSize, 3, 'only 3 to 5');
});

test('a renamed step keeps its name, escaped, and a milestone-only phase says it builds nothing', async () => {
  const first = (await openLineSteps())[0]!;
  page();
  await show({
    version: 3,
    taskEdits: { order: {}, removed: [], titles: { [first]: evil }, bodies: {}, links: {} },
  });
  assert.equal(text($(`[data-session-build="${first}"] h2`)), '1 ' + evil);
  assert.equal($('x-evil'), null);
  assert.ok($<HTMLTextAreaElement>('[data-session-note]')!.value.includes('1) <x-evil'));
  page();
  await show({}, 'session', '2');
  assert.match(text($('[data-session-none]')), /^Phase 2 plans no production lines/);
});
