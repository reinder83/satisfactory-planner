// ADA's power remark on real calculated plans (public/ada.ts, facts from adaFacts in
// public/app/ada-panel.ts), in happy-dom: its figures are the stage's own power as every page
// reads it (powerView in public/power.ts, #1064), and they add up to the headroom the notice asks
// for on every phase (#334). A plan made since #1064 sizes its generators to its need, so only
// Phase 1 (biomass) asks for more; the same plans stored without their grid, as a release before
// #1064 stored them, still ask on every phase and read their own figures, as a plan the first
// release stored does (tests/fixtures/calculated-plan-2026-09-12.json).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { powerView } from '../../public/power.ts';
import { generated, generatedWith, go, open, page } from './setup.ts';
import type {
  CurrentCalculatedPlan,
  Phase,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

beforeEach(() => {
  page();
  setAdaIndex(0);
  adaClearFault();
});

// The power remark ADA gives on `phase` of `plan`, or undefined when she has none.
function powerRemark(plan: StoredCalculatedPlan, phase: Phase) {
  open({ calculated: plan, phase });
  go('resources');
  for (let i = 0; i < 40; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === 'power') return line.text;
  }
  return undefined;
}

// `plan` as a release before #1064 stored it: no grid on any stage.
function storedBefore1064(plan: CurrentCalculatedPlan): StoredCalculatedPlan {
  const copy: StoredCalculatedPlan = structuredClone(plan);
  for (const stage of Object.values(copy.stages)) delete stage.grid;
  return copy;
}

const phases = ['1', '2', '3', '4', '5', 'post'] as const;

// Every phase of `plan` with headroom: the remark names the draw, the stage's own generation
// (from Phase 2 on) and the listed spare power, and draw minus those is the headroom.
function checkPlan(plan: StoredCalculatedPlan, label: string) {
  // Start in Phase 1, so every phase can be shown.
  plan.settings.phase = '1';
  let seen = 0;
  for (const phase of phases) {
    const view = powerView(plan.stages[phase === 'post' ? '5' : phase], plan.settings);
    const text = powerRemark(plan, phase);
    if (!(view.shortMW > 0)) {
      assert.equal(text, undefined, `${label} ${phase}: no headroom, no remark`);
      continue;
    }
    seen++;
    assert.ok(text, `${label} ${phase}: headroom draws the remark`);
    // Draw minus what the plan counts on is the headroom.
    assert.ok(
      Math.abs(view.needMW - view.generationMW - view.spareMW - view.augmenterMW - view.shortMW) <
        1e-6,
      `${label} ${phase}: the stage's figures add up`,
    );
    assert.ok(text.startsWith(power(view.shortMW) + ' of power headroom'), text);
    assert.ok(text.includes(`a ${power(view.needMW)} draw against `), text);
    assert.ok(text.includes(`the ${power(view.spareMW)} you listed as spare`), text);
    if (view.generationMW > 0.01)
      assert.ok(
        text.includes(`against ${power(view.generationMW)} of planned generation and`),
        text,
      );
    else assert.doesNotMatch(text, /planned generation/, `${label} ${phase}: ${text}`);
    if (view.augmenterMW > 0.01)
      assert.ok(
        text.includes(`(${power(view.spareMW + view.augmenterMW)} with the augmenters)`),
        text,
      );
    else assert.doesNotMatch(text, /augmenters/, `${label} ${phase}: ${text}`);
    if (phase === '1') {
      assert.equal(view.generationMW, 0, 'Phase 1 plans no generators');
      assert.match(
        text,
        /Phase 1 plans no generators: burn biomass, or bring existing generation\.$/,
      );
    } else assert.doesNotMatch(text, /biomass/, `${label} ${phase}: ${text}`);
  }
  return seen;
}

test('ADA counts the plan’s own generation in her power remark, with no spare power', () => {
  const plan = generated();
  assert.equal(plan.settings.availablePowerGW, 0);
  plan.settings.phase = '1';
  // Its generators cover every phase from 2 on; Phase 1 runs on biomass.
  assert.equal(checkPlan(structuredClone(plan), 'no spare'), 1, 'only Phase 1 asks for more');
  assert.match(powerRemark(plan, '1')!, /Phase 1 plans no generators/);
  assert.equal(powerRemark(plan, '2'), undefined);
  // The plan the first release stored had headroom on every phase. Phase 2, as in the issue: a
  // draw set against planned generation. The figures are toLocaleString's, so either decimal mark
  // (and digit grouping) is accepted.
  const stored: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync('tests/fixtures/calculated-plan-2026-09-12.json', 'utf8'),
  );
  assert.equal(checkPlan(stored, 'no spare, stored'), phases.length, 'every phase has headroom');
  assert.match(
    powerRemark(stored, '2')!,
    /^[\d.,]+ MW of power headroom is still unaccounted for: a [\d.,]+ MW draw against [\d.,]+ MW of planned generation and the 0 MW you listed as spare\. .* Build generation beyond what the plan lists\.$/,
  );
});

// Each plan is calculated in Node (setup.ts) and takes a few seconds: past Vitest's default 5 s.
test('ADA’s power figures add up with spare power', () => {
  for (const spareGW of [0.1, 0.5]) {
    const plan = generatedWith({ availablePowerGW: spareGW, installedPowerGW: spareGW });
    checkPlan(structuredClone(plan), `${spareGW} GW`);
    assert.ok(checkPlan(storedBefore1064(plan), `${spareGW} GW, stored`));
  }
}, 60000);

test('ADA’s power figures add up with Phase 5 augmenters', () => {
  const augmented = generatedWith({
    availablePowerGW: 3,
    installedPowerGW: 5,
    augmenters: 2,
    fueledAugmenters: 1,
    somersloops: 40,
  });
  assert.ok(augmented.stages['5'].boost! > 0, 'Phase 5 has the augmenter boost');
  checkPlan(structuredClone(augmented), 'augmenters');
  const stored = storedBefore1064(augmented);
  assert.ok(checkPlan(stored, 'augmenters, stored'));
  assert.match(
    powerRemark(stored, '5')!,
    /the 3 GW you listed as spare \([\d.,]+ GW with the augmenters\)/,
  );
}, 60000);

test('ADA has no power remark on the handbook profile', () => {
  open();
  go('resources');
  for (let i = 0; i < 40; i++) {
    setAdaIndex(i);
    assert.notEqual(adaCurrent()?.id, 'power');
  }
});
