// ADA's power remark on real calculated plans (public/ada.ts, facts from adaFacts in
// public/app/ada-panel.ts), in happy-dom: its figures are the stage's own, and they add up to
// the whole-building headroom the notice asks for on every phase (#334).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { power } from '../../public/app/wizard/fields.ts';
import { generated, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

beforeEach(() => {
  page();
  setAdaIndex(0);
  adaClearFault();
});

// The power remark ADA gives on `phase` of `plan`, or undefined when she has none.
function powerRemark(plan: CurrentCalculatedPlan, phase: Phase) {
  open({ calculated: plan, phase });
  go('resources');
  for (let i = 0; i < 40; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === 'power') return line.text;
  }
  return undefined;
}

const phases = ['1', '2', '3', '4', '5', 'post'] as const;

// Every phase of `plan` with headroom: the remark names the draw, the stage's own generation
// (from Phase 2 on) and the listed spare power, and draw minus those is the headroom.
function checkPlan(plan: CurrentCalculatedPlan, label: string) {
  // Start in Phase 1, so every phase can be shown.
  plan.settings.phase = '1';
  const spareMW = plan.settings.availablePowerGW * 1000;
  let seen = 0;
  for (const phase of phases) {
    // Figures a stage lacks default to 0, as the pages read them.
    const {
      requiredMW = 0,
      generationMW: builtMW = 0,
      boost = 0,
      availableMW = 0,
      additionalHeadroomMW: headroomMW = 0,
    } = plan.stages[phase === 'post' ? '5' : phase];
    const text = powerRemark(plan, phase);
    if (!(headroomMW > 0.01)) {
      assert.equal(text, undefined, `${label} ${phase}: no headroom, no remark`);
      continue;
    }
    seen++;
    assert.ok(text, `${label} ${phase}: headroom draws the remark`);
    const generationMW = builtMW * (1 + boost);
    const effectiveMW = availableMW - generationMW;
    // The planner's own figures: draw minus what the plan counts on is the headroom.
    assert.ok(
      Math.abs(requiredMW - generationMW - effectiveMW - headroomMW) < 1e-6,
      `${label} ${phase}: the stage's figures add up`,
    );
    assert.ok(text.startsWith(power(headroomMW) + ' of whole-building'), text);
    assert.ok(text.includes(`a ${power(requiredMW)} draw against `), text);
    assert.ok(text.includes(`the ${power(spareMW)} you listed as spare`), text);
    if (generationMW > 0.01)
      assert.ok(text.includes(`against ${power(generationMW)} of planned generation and`), text);
    else assert.doesNotMatch(text, /planned generation/, `${label} ${phase}: ${text}`);
    if (effectiveMW - spareMW > 0.01)
      assert.ok(text.includes(`(${power(effectiveMW)} with the augmenters)`), text);
    else assert.doesNotMatch(text, /augmenters/, `${label} ${phase}: ${text}`);
    if (phase === '1') {
      assert.equal(generationMW, 0, 'Phase 1 plans no generators');
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
  assert.equal(checkPlan(plan, 'no spare'), phases.length, 'every phase has headroom');
  // Phase 2 of the default plan, as in the issue: a draw set against planned generation.
  assert.match(
    powerRemark(plan, '2')!,
    /^[\d,]+ MW of whole-building power headroom is still unaccounted for: a [\d,]+ MW draw against [\d,]+ MW of planned generation and the 0 MW you listed as spare\. .* Build generation beyond what the plan lists\.$/,
  );
});

// Each plan is calculated in Node (setup.ts) and takes a few seconds: past Vitest's default 5 s.
test('ADA’s power figures add up with spare power', () => {
  assert.ok(checkPlan(generatedWith({ availablePowerGW: 0.1, installedPowerGW: 0.1 }), '100 MW'));
  assert.ok(checkPlan(generatedWith({ availablePowerGW: 0.5, installedPowerGW: 0.5 }), '500 MW'));
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
  assert.ok(checkPlan(augmented, 'augmenters'));
  assert.match(
    powerRemark(augmented, '5')!,
    /the 3 GW you listed as spare \([\d,]+ GW with the augmenters\)/,
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
