// Why a plan sinks its spare Petroleum Coke rather than burning it (#1063, the owner's decision):
// under rocket fuel or nuclear main power the Petroleum Coke line uses up the Heavy Oil Residue of
// the standard Plastic and Rubber lines, and burning the coke in Coal Generators would take more
// machines than it saves, so the plan sinks it. The line's build-plan step and its production
// line dialog say so and point at coal power, which burns it (#1055). A coal plan gets no such
// sentence: a fresh one burns its coke, and one stored before #1055 still sinks it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, catalog, generatedWith, go, open, page } from './setup.ts';
import type { StageKey, StoredCalculatedPlan } from '../../public/types/index.ts';

const COKE = 'Recipe_PetroleumCoke_C';
const SENTENCE = (power: string) =>
  `The plan sinks its spare Petroleum Coke: burning it in Coal Generators would need more machines than it saves in the ${power} power chain. With coal power, the plan burns it in Coal Generators instead.`;
// A Phase 3 profile on whole machines with the standard recipes, as the issue measured it.
const PROFILE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());

function show(plan: StoredCalculatedPlan, phase: StageKey) {
  page();
  open({ calculated: plan, phase, workspace: { catalog: catalog() } });
  go('plan');
  render();
}
const stepBody = (phase: StageKey, id: string) =>
  planTasks(phase).find(step => step.id === `calc-${phase}-${id}`)?.body ?? '';
const notes = () =>
  [...document.querySelectorAll('[data-burn-note]')].map(note => note.textContent?.trim());

beforeEach(() => page());

for (const [mainPower, extra, power] of [
  ['rocket', {}, 'rocket fuel'],
  ['nuclear', { nuclear: 'sink' }, 'nuclear'],
] as const)
  test(`a ${mainPower} Phase 4 plan says why it sinks its Petroleum Coke and points at coal power`, async () => {
    const plan = generatedWith({ ...PROFILE, mainPower, ...extra });
    const stage = plan.stages['4'];
    const line = stage.rows!.find(row => row.id === COKE)!;
    assert.ok(line, 'a Petroleum Coke line');
    assert.ok((stage.surplus?.['Petroleum Coke'] ?? 0) > 0, 'that sinks its coke');
    assert.ok(
      !stage.rows!.some(row => row.generationMW > 0 && row.inputs['Petroleum Coke']),
      'and no generator line burns it',
    );
    show(plan, '4');
    const body = stepBody('4', COKE);
    // After the line's outputs, before its input advice.
    assert.ok(body.includes('/min. ' + SENTENCE(power) + ' Heavy Oil Residue'), body);
    assert.equal(body.split(SENTENCE(power)).length, 2, 'once');
    openCalculatedFactory(COKE);
    await settle();
    assert.deepEqual(notes(), [SENTENCE(power)]);
    // A line that makes no coke says nothing of it.
    openCalculatedFactory(stage.rows!.find(row => row.id === 'Recipe_Plastic_C')!.id);
    await settle();
    assert.deepEqual(notes(), []);
  });

test('a coal plan gets no such sentence: a fresh one burns its coke, one stored before #1055 sinks it', async () => {
  const fresh = generatedWith({ ...PROFILE, mainPower: 'coal' });
  assert.ok(fresh.stages['4'].rows!.some(row => row.id === 'power-petroleum-coke'));
  show(fresh, '4');
  assert.ok(planTasks('4').every(step => !step.body?.includes('The plan sinks its spare')));
  // The issue's plan as stored before #1055: 480 Petroleum Coke/min to the sink on coal power.
  const stored: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync('tests/fixtures/coal-power-plan-2026-10-10.json', 'utf8'),
  );
  assert.equal(stored.stages['3'].surplus!['Petroleum Coke'], 480);
  show(stored, '3');
  assert.ok(planTasks('3').every(step => !step.body?.includes('The plan sinks its spare')));
  openCalculatedFactory(COKE);
  await settle();
  assert.ok($('[data-exact-clock-note]') || $('[data-exact-clock-fixed]'), 'the dialog is open');
  assert.deepEqual(notes(), []);
});
