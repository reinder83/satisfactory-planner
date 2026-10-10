import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import type { Context } from 'node:vm';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { calculate, catalog, DELIVERIES, DEFAULT_LIMITS, PURE_LIMITS } from '../planner.ts';
import { nodeCounts } from '../public/preferences.ts';
import {
  deliveryKey,
  firstPlanPhase,
  milestoneOnlyPhase,
  phaseSteps,
  powerFirst,
  progression,
  recipeIdOf,
  rowStepTitle,
} from '../public/progression.ts';
import { adaRemarks, adaEncore, adaFault as makeFault } from '../public/ada.ts';
import { appSource } from './helpers/app-source.ts';
import type { AdaFacts } from '../public/ada.ts';
import type {
  CurrentCalculatedPlan,
  CurrentStage,
  StoredCalculatedPlan,
  StoredSettings,
} from '../public/types/index.ts';
import {
  carryOptions,
  pickedRecipeUnlocks,
  bayCapacity,
  bayOfSlot,
  slotPosition,
  newProfileState,
  initialState,
} from '../public/state.ts';
import {
  droneFuels,
  storageOptions,
  distributions,
  purities,
  powerOptions,
  resourceDefaults,
  helpText,
  wantsStorage,
  storageRateFor,
  guidedQuestions,
  guidedBudgetsQuestion,
  guidedHaveQuestion,
  guidedStandingQuestion,
  guidedTopupItems,
  GUIDED_TOPUP_RATE,
  tutorialKeys,
  phaseParts,
  constructionItems,
  purities3,
  minerMarks,
  clockChoices,
  minedResources,
  blankCounts,
  blankExtraction,
  nodeYield,
  wellYield,
  resourcePool,
  extractionLimits,
  nodePresets,
  presetSurvey,
  presetCounts,
  matchingPreset,
  startingSurvey,
  knownWorld,
  presetPurities,
  uniformPurities,
  richShape,
  waterExtractors,
  BELT_MARKS,
  MINER_MARKS,
  PIPE_MARKS,
  EXTRACTOR_OPTIONS,
  isWellKind,
  miningAdvice,
  phaseBelt,
  phaseForTier,
  phaseMiner,
  phaseMining,
  OWNED_GENERATORS,
  ownedGeneratorCounts,
} from '../public/preferences.ts';

const source = appSource();
// The same VM harness the interface tests use: app.ts runs with its imports
// supplied as globals, so its render functions can be called directly.
function ui() {
  const node = {
    addEventListener() {},
    close() {},
    showModal() {},
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    document: {
      querySelector: () => node,
      querySelectorAll: () => [],
      addEventListener() {},
      activeElement: null,
    },
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: '#plan' },
    // The toast's placement watcher (listeners.ts, #663).
    MutationObserver: class {
      observe() {}
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    JSON,
    structuredClone,
    browserMode: false,
    FormData: class {
      [Symbol.iterator]() {
        return [][Symbol.iterator]();
      }
      get() {
        return null;
      }
      getAll() {
        return [];
      }
      has() {
        return false;
      }
    },
    adaRemarks,
    adaEncore,
    makeFault,
    progression,
    phaseSteps,
    milestoneOnlyPhase,
    recipeIdOf,
    rowStepTitle,
    firstPlanPhase,
    powerFirst,
    deliveryKey,
    carryOptions,
    pickedRecipeUnlocks,
    bayCapacity,
    bayOfSlot,
    slotPosition,
    droneFuels,
    storageOptions,
    distributions,
    purities,
    powerOptions,
    resourceDefaults,
    helpText,
    wantsStorage,
    storageRateFor,
    guidedQuestions,
    guidedBudgetsQuestion,
    guidedHaveQuestion,
    guidedStandingQuestion,
    guidedTopupItems,
    GUIDED_TOPUP_RATE,
    tutorialKeys,
    purities3,
    minerMarks,
    clockChoices,
    minedResources,
    blankCounts,
    blankExtraction,
    nodeYield,
    wellYield,
    resourcePool,
    extractionLimits,
    nodePresets,
    presetSurvey,
    presetCounts,
    matchingPreset,
    startingSurvey,
    knownWorld,
    presetPurities,
    uniformPurities,
    richShape,
    // ADA's Water count (#1024), for a plan whose phase extracts Water.
    waterExtractors,
    // The belt and pipe marks (flow.ts) and the mining per phase (mining.ts, #1065).
    BELT_MARKS,
    // The miner marks, which the ticks keep current (owned-ticks.ts, #1068).
    MINER_MARKS,
    PIPE_MARKS,
    EXTRACTOR_OPTIONS,
    isWellKind,
    miningAdvice,
    phaseBelt,
    phaseForTier,
    phaseMiner,
    phaseMining,
    // The generators the player already has (#1068): ADA and the wizard reader.
    OWNED_GENERATORS,
    ownedGeneratorCounts,
  });
  vm.runInContext(source, context);
  context.catalogData = catalog();
  context.progressionFixture = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  context.generated = calculate({});
  vm.runInContext(
    `progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World'};currentProfile={id:'p',kind:'calculated',name:'Balanced'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};calculated=generated;`,
    context,
  );
  return context;
}
const guided = (context: Context, extra = '') =>
  vm.runInContext(
    `wizard={step:1,saveId:null,saveName:'World',name:'',settings:structuredClone(generated.settings),preview:null,carryFrom:null,carry:{},mode:'guided',guidedStep:1,guidedAsk:null,tutorial:'doing'};${extra}`,
    context,
  );

// The wizard and guided screens themselves: tests/ui/wizard.test.ts.

test('guided answers write the same settings object the wizard writes', () => {
  const context = ui();
  guided(context);
  const form = (answers: Record<string, string | string[]>) => ({
    querySelector: (selector: string) => (selector === '.guided-topup' ? {} : null),
    entries: () => [],
    __answers: answers,
  });
  // FormData is not available in the harness, so drive readGuided through a stub
  // that answers exactly as the rendered radios would.
  vm.runInContext(
    `FormData=class{constructor(f){this.f=f;}get(k){return this.f.__answers[k]??null;}getAll(k){const v=this.f.__answers[k];return v===undefined?[]:[].concat(v);}has(k){return this.f.__answers[k]!==undefined;}}`,
    context,
  );
  context.formFor = form;
  vm.runInContext(
    `readGuided(formFor({'guided:phase':'4','guided:goal':'minimal','guided:recipes':'all','guided:stock':'construction','guided:exact':'precise',topup:['Concrete','Iron Rod']}))`,
    context,
  );
  const settings = vm.runInContext('JSON.parse(JSON.stringify(wizard.settings))', context);
  assert.equal(settings.phase, '4');
  assert.equal(settings.goal, 'minimal');
  assert.equal(settings.recipes, 'all');
  assert.equal(settings.storage, 'construction');
  assert.equal(settings.wholeMachines, false);
  // The general construction rate is the most expensive control in the app and
  // the guided start never raises it; the per-item floors do the same job.
  assert.equal(settings.buildRate, 1);
  assert.equal(settings.storageRate, 1);
  assert.deepEqual(settings.storageOverrides, {
    Concrete: GUIDED_TOPUP_RATE,
    'Iron Rod': GUIDED_TOPUP_RATE,
  });
  // And the result is a settings object the planner accepts unchanged.
  const plan = calculate(settings);
  assert.equal(plan.settings.phase, '4');
  assert.equal(plan.settings.storageOverrides.Concrete, GUIDED_TOPUP_RATE);
  assert.equal(plan.stages[4].feasible, true);
});

test('switching to All settings keeps every guided answer and can switch back', () => {
  const context = ui();
  guided(context);
  vm.runInContext(
    `FormData=class{constructor(){}get(){return null;}getAll(){return [];}has(){return false;}*[Symbol.iterator](){}}`,
    context,
  );
  vm.runInContext(
    `wizard.settings.goal='minimal';wizard.settings.phase='5';toAdvanced(3)`,
    context,
  );
  assert.equal(vm.runInContext('wizard.mode', context), 'advanced');
  assert.equal(
    vm.runInContext('wizard.step', context),
    3,
    'lands on the step that owns the question',
  );
  assert.equal(
    vm.runInContext('wizard.settings.goal', context),
    'minimal',
    'answers survive the switch',
  );
  assert.equal(vm.runInContext('wizard.settings.phase', context), '5');
  vm.runInContext('toGuided()', context);
  assert.equal(vm.runInContext('wizard.mode', context), 'guided');
  assert.equal(vm.runInContext('wizard.settings.goal', context), 'minimal');
});

test('the tutorial question is asked at Phase 1, and "What you already have" and the already-running one after it', () => {
  const context = ui();
  guided(context);
  vm.runInContext(`wizard.settings.phase='1'`, context);
  assert.equal(
    vm.runInContext(`guidedFlow().map(q=>q.id).join(',')`, context),
    'phase,tutorial,goal,recipes,stock,exact,power',
  );
  vm.runInContext(`wizard.settings.phase='3'`, context);
  assert.equal(
    vm.runInContext(`guidedFlow().map(q=>q.id).join(',')`, context),
    'phase,have,supply,goal,recipes,stock,exact,power',
  );
  // A save that already has profiles uses the Review step's carry panel instead.
  vm.runInContext(`wizard.saveId='s1'`, context);
  assert.equal(
    vm.runInContext(`guidedFlow().map(q=>q.id).join(',')`, context),
    'phase,goal,recipes,stock,exact,power',
  );
});

test('a second profile for a save you already play is asked what changed, not everything again', () => {
  const context = ui();
  vm.runInContext(
    `workspace.saves=[{id:'s1',name:'World',activeProfile:'p1',profiles:[{id:'p1',name:'First run',kind:'calculated'}]}];`,
    context,
  );
  guided(context, `wizard.saveId='s1';wizard.saveName='World';wizard.carryFrom='p1';`);
  // Nothing chosen yet: the topic picker comes first, and asks every question it offers.
  assert.equal(vm.runInContext('wizard.guidedAsk', context), null);
  // Choosing only the phase asks only the phase.
  vm.runInContext(`wizard.guidedAsk=['phase']`, context);
  assert.equal(vm.runInContext("guidedFlow().map(q=>q.id).join(',')", context), 'phase');
});

test('a new profile without a list of finished work is exactly the blank state as before', () => {
  const plan = calculate({ phase: '3' });
  // @ts-expect-error: deliberately called without `built`, as callers did before it existed
  const blank = newProfileState(plan, null, null, undefined);
  const withEmpty = newProfileState(plan, null, null, undefined, []);
  assert.deepEqual(withEmpty.state, blank.state, 'an empty list changes nothing');
  assert.deepEqual(blank.state.checks, {}, 'no checks are invented');
  assert.equal(blank.carried, 0);
  assert.equal(blank.reviewCount, 0);
  // The shape earlier releases produced, beside a state built from scratch.
  const fresh = initialState();
  fresh.settings.phase = '3';
  assert.deepEqual(blank.state.notes, fresh.notes);
  assert.deepEqual(blank.state.deliveries, fresh.deliveries);
  assert.equal(
    blank.state.version,
    3,
    'default factory groups make it a version 3 state, exactly as before',
  );
});

test('finished work ticks only keys the plan or the world recognises', () => {
  const plan = calculate({ phase: '3' });
  const row = plan.stages[3].rows![0]!.id;
  const { state, carried } = newProfileState(plan, null, null, undefined, [
    'calc-3-' + row,
    ...tutorialKeys,
    'calc-3-Recipe_DoesNotExist_C', // not in this plan
    'slot-A01-built', // storage is not a production line
    'deliveries-3', // nor a delivery
    '__proto__',
  ]);
  assert.equal(state.checks['calc-3-' + row], true);
  assert.equal(state.checks['early-base-hub'], true);
  assert.equal(state.checks['unlock-Schematic_Tutorial5_C'], true);
  assert.equal(
    state.checks['calc-3-Recipe_DoesNotExist_C'],
    undefined,
    'a row this plan does not build is dropped',
  );
  assert.equal(state.checks['slot-A01-built'], undefined, 'storage progress is not implied');
  assert.equal(state.checks['deliveries-3'], undefined);
  assert.equal(Object.hasOwn(state.checks, '__proto__'), false);
  assert.equal(carried, 3);
  assert.throws(
    () => newProfileState(plan, null, null, undefined, 'not an array'),
    /finished work/,
  );
  assert.throws(
    () => newProfileState(plan, null, null, undefined, new Array(2001).fill('calc-3-' + row)),
    /finished work/,
  );
});

test('a source profile still wins over a key reported as already finished', () => {
  const plan = calculate({ phase: '3' });
  const row = plan.stages[3].rows![0]!.id,
    key = 'calc-3-' + row;
  const source = initialState();
  source.checks[key] = false;
  // The previous profile deliberately left this line unticked; carrying its
  // factory progress must not be overruled by the guided answer.
  const { state } = newProfileState(plan, source, plan, { factories: true }, [key]);
  assert.notEqual(state.checks[key], true, 'the line is not reported as built');
  assert.equal(
    Object.values(state.checks).filter(Boolean).length,
    0,
    'and nothing else is invented either',
  );
});

test('a profile created from the guided start keeps its ticks through the server', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-guided-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = (endpoint: string, body: unknown) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
  try {
    const settings = {
      phase: '3',
      goal: 'balanced',
      recipes: 'standard',
      storage: 'construction',
      storageRate: 1,
      buildRate: 1,
      wholeMachines: true,
      storageOverrides: { Concrete: GUIDED_TOPUP_RATE },
    };
    const plan = calculate(settings);
    const built = plan.stages[3].rows!.slice(0, 4).map(r => 'calc-3-' + r.id);
    const created = await post('/api/profiles', {
      saveName: 'Guided world',
      name: 'Guided',
      settings,
      built,
    }).then(response => response.json());
    assert.ok(created.profileId);
    assert.equal(created.carriedChecks, 4, 'the marked lines are reported back');
    const context = await fetch(
      url + '/api/context?save=' + created.saveId + '&profile=' + created.profileId,
    ).then(response => response.json());
    for (const key of built) assert.equal(context.state.checks[key], true, key);
    assert.equal(
      Object.values(context.state.checks).filter(Boolean).length,
      4,
      'and nothing else is ticked',
    );
    assert.equal(context.plan.settings.storageOverrides.Concrete, GUIDED_TOPUP_RATE);
    // A profile made without the new field is still the blank state.
    const plain = await post('/api/profiles', {
      saveId: created.saveId,
      name: 'Plain',
      settings,
    }).then(response => response.json());
    const plainContext = await fetch(
      url + '/api/context?save=' + created.saveId + '&profile=' + plain.profileId,
    ).then(response => response.json());
    assert.deepEqual(plainContext.state.checks, {});
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the phase cards use bundled, attributed artwork that matches the deliveries', () => {
  const sources = JSON.parse(
    fs.readFileSync(new URL('../public/icons/sources.json', import.meta.url), 'utf8'),
  );
  for (const [phase, parts] of Object.entries(phaseParts)) {
    assert.deepEqual(
      [...parts].sort(),
      Object.keys(DELIVERIES[Number(phase)]!).sort(),
      'phase ' + phase + ' shows the parts it delivers',
    );
  }
  // Every icon the guided start names must be bundled and attributed, the same
  // rule the storage room follows. No new imagery is introduced.
  for (const name of [...Object.values(phaseParts).flat(), ...guidedTopupItems]) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const png = fs.readFileSync(new URL('../public/icons/' + slug + '.png', import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', name);
    assert.match(sources[name].source, /^https:\/\/satisfactory\.wiki\.gg\//, name);
  }
  // The top-up list is construction material, which is what buildRate covers.
  for (const name of guidedTopupItems) assert.ok(constructionItems.includes(name), name);
  assert.ok(guidedTopupItems.includes('Concrete'), 'the one the plan leaves least surplus for');
});

test('every guided question reads as a question and names the step that owns it', () => {
  const seen = new Set();
  for (const question of [
    ...guidedQuestions,
    guidedStandingQuestion('1'),
    guidedStandingQuestion('3'),
    guidedHaveQuestion('3'),
    guidedBudgetsQuestion,
  ]) {
    assert.ok(question.title && question.lead, question.id + ' reads as a question');
    assert.ok(
      question.short && question.short.length <= 20,
      question.id + ' has a short name for the progress strip',
    );
    assert.ok(
      question.step >= 1 && question.step <= 4,
      question.id + ' names the advanced step that owns it',
    );
    // Three questions are inputs rather than a choice; the rest are picture cards.
    if (question.kind) {
      assert.ok(!question.options, question.id);
      continue;
    }
    // Every question but the supply one is a choice with options.
    assert.ok(question.options!.length >= 2, question.id);
    for (const option of question.options!) {
      assert.ok(
        option.label && option.detail,
        question.id + '/' + option.value + ' is a picture and a sentence',
      );
      assert.ok(option.items || option.glyph, question.id + '/' + option.value + ' has artwork');
      assert.ok(
        option.set && typeof option.set === 'object',
        question.id + '/' + option.value + ' says what it sets',
      );
      seen.add(question.id + ':' + option.value);
    }
  }
  assert.ok(seen.size >= 15);
  // Every option's settings patch, applied on its own, is a plan the planner makes.
  for (const question of guidedQuestions)
    for (const option of question.options!) {
      assert.doesNotThrow(
        () => calculate({ phase: '3', limitsConfirmed: true, ...option.set }),
        question.id + '/' + option.value,
      );
    }
});

test('ADA has something to say about the guided start', () => {
  const ids = (given: Partial<AdaFacts>) => new Set(adaRemarks(given).map(r => r.id));
  assert.ok(ids({ view: 'wizard', guided: true, guidedStep: 2, guidedTotal: 6 }).has('guided'));
  assert.ok(ids({ view: 'wizard', supplyDeclared: 2 }).has('guided-supply'));
  assert.ok(ids({ view: 'wizard', tutorialDone: true }).has('guided-tutorial'));
  // The remark repeats the plan's own promise and never claims the plan changed.
  const supply = adaRemarks({ view: 'wizard', supplyDeclared: 2 }).find(
    r => r.id === 'guided-supply',
  )!;
  assert.match(supply.text, /2 lines/);
  assert.match(supply.text, /skip the chain behind them/);
  // The existing wizard remark still leads a plain wizard view.
  assert.ok(!ids({ view: 'wizard' }).has('guided'), 'nothing fires without the guided flow');
});

test('the only progress a guided answer can tick is the HUB tutorial', () => {
  const context = ui();
  guided(context, `wizard.step=5;wizard.guidedStep=99;wizard.preview=generated;`);
  // Everything else the guided start learns is a rate, which changes the plan
  // rather than its progress — so there is no production line to pre-tick and no
  // way to claim work the user did not do.
  assert.equal(vm.runInContext('guidedBuiltKeys(wizard).length', context), 0);
  vm.runInContext(`wizard.settings.existingSupply={'Modular Frame':50};`, context);
  assert.equal(
    vm.runInContext('guidedBuiltKeys(wizard).length', context),
    0,
    'declaring a line ticks nothing',
  );
  vm.runInContext(`wizard.tutorial='done'`, context);
  assert.equal(
    vm.runInContext('guidedBuiltKeys(wizard).join(",")', context),
    tutorialKeys.join(','),
  );
});

test('leaving the "what is different" screen starts the questions it chose', async () => {
  const context = ui();
  vm.runInContext(
    `workspace.saves=[{id:'s1',name:'World',activeProfile:'p1',profiles:[{id:'p1',name:'First run',kind:'calculated'}]}];`,
    context,
  );
  guided(context, `wizard.saveId='s1';wizard.saveName='World';wizard.carryFrom='p1';`);
  vm.runInContext(
    `FormData=class{constructor(f){this.f=f;}get(){return null;}getAll(k){return k==='topic'?['phase','goal']:[];}has(){return false;}*[Symbol.iterator](){}}`,
    context,
  );
  // $('#wizard-form') reads document.querySelector, so stand a form in for it.
  context.formStub = {
    querySelector: (selector: string) => (selector === '.guided-topics' ? {} : null),
    reportValidity: () => true,
  };
  vm.runInContext(
    'render=()=>{};document={querySelector:()=>formStub,querySelectorAll:()=>[],addEventListener(){}};',
    context,
  );
  await vm.runInContext('moveGuided(2)', context);
  assert.equal(
    vm.runInContext('wizard.guidedStep', context),
    1,
    'it starts at the first chosen question, not past it',
  );
  assert.equal(vm.runInContext(`wizard.guidedAsk.join(',')`, context), 'phase,goal');
  assert.equal(vm.runInContext('guidedFlow().length', context), 2);
  assert.equal(vm.runInContext('wizard.mode', context), 'guided', 'and it has not calculated yet');
});

// --- Production you already run ---------------------------------------------
// A plan's stages, or a single stage, as text without the calculation time.
const strip = (planOrStage: CurrentCalculatedPlan | CurrentStage) =>
  JSON.stringify('stages' in planOrStage ? planOrStage.stages : planOrStage, (key, value) =>
    key === 'createdAt' ? undefined : value,
  );
const machines = (stage: CurrentStage) =>
  stage.feasible ? (stage.rows || []).reduce((total, r) => total + r.machines, 0) : null;
const BASE = {
  phase: '3',
  goal: 'balanced',
  wholeMachines: true,
  storage: 'construction',
  limitsConfirmed: true,
};

test('a profile that declares nothing calculates exactly as it did before', () => {
  const absent = calculate(BASE);
  assert.equal(
    strip(calculate({ ...BASE, existingSupply: {} })),
    strip(absent),
    'an empty map changes nothing',
  );
  assert.equal(
    strip(calculate({ ...BASE, existingSupply: { 'Modular Frame': 0 } })),
    strip(absent),
    'a zero rate is not a declaration',
  );
  assert.equal(
    absent.settings.existingSupply && Object.keys(absent.settings.existingSupply).length,
    0,
  );
  // And a plan saved before the field existed still validates and recalculates.
  const legacy: StoredSettings = { ...absent.settings };
  delete legacy.existingSupply;
  assert.equal(strip(calculate(legacy)), strip(absent));
});

test('declaring a line you already run removes it and the chain behind it', () => {
  const before = calculate(BASE);
  const after = calculate({ ...BASE, existingSupply: { 'Modular Frame': 50 } });
  const stage = after.stages[3];
  assert.equal(stage.feasible, true);
  assert.ok(
    !(stage.rows || []).some(r => r.outputs['Modular Frame']),
    'no Modular Frame line is planned',
  );
  // Both plans fit, so both have a machine count.
  assert.ok(machines(stage)! < machines(before.stages[3])!, 'fewer buildings');
  // The point of a rate rather than a tick: the ore behind it goes too.
  assert.ok(
    stage.raw['Iron Ore']! < before.stages[3].raw!['Iron Ore']! - 100,
    'the iron behind it is not mined either',
  );
  assert.ok(stage.requiredMW < before.stages[3].requiredMW!, 'and its power is not budgeted');
  // It draws only what the plan needs, never the whole declared rate.
  assert.ok(stage.supplied['Modular Frame']! > 0 && stage.supplied['Modular Frame']! <= 50);
  const plenty = calculate({ ...BASE, existingSupply: { 'Modular Frame': 5000 } });
  assert.equal(
    plenty.stages[3].supplied!['Modular Frame'],
    stage.supplied['Modular Frame'],
    'declaring more than the plan uses changes nothing further',
  );
});

test('a partial rate is credited and the remainder is still planned', () => {
  const some = calculate({ ...BASE, existingSupply: { 'Modular Frame': 10 } });
  const stage = some.stages[3];
  assert.equal(stage.supplied!['Modular Frame'], 10, 'all of it is used');
  assert.ok(
    (stage.rows || []).some(r => r.outputs['Modular Frame']),
    'and the rest is still built',
  );
  assert.ok(machines(stage)! < machines(calculate(BASE).stages[3])!);
});

test('declaring production never costs you a plan', { timeout: 600000 }, () => {
  // Crediting a line narrows the recipe network, and a narrow network has less
  // room to round up to whole machines. Every one of these fits without the
  // credit, so every one of them must still produce a plan with it.
  for (const [item, rate] of [
    ['Modular Frame', 50],
    ['Computer', 20],
    ['Heavy Modular Frame', 30],
    ['Motor', 40],
    ['Plastic', 300],
  ] satisfies [string, number][]) {
    const plan = calculate({ ...BASE, existingSupply: { [item]: rate } });
    for (const phase of ['3', '4', '5'] as const)
      assert.equal(
        plan.stages[phase].feasible,
        true,
        item + ' made phase ' + phase + ' infeasible',
      );
  }
});

test('an item this phase never touches is simply ignored', () => {
  const odd = calculate({ ...BASE, existingSupply: { 'Ballistic Warp Drive': 5 } });
  assert.equal(strip(calculate(BASE).stages[3]), strip(odd.stages[3]), 'Phase 3 is untouched');
  assert.equal(Object.keys(odd.stages[3].supplied || {}).length, 0);
});

test('only real, non-raw items can be declared', () => {
  assert.throws(
    () => calculate({ ...BASE, existingSupply: { 'Iron Ore': 500 } }),
    /cannot be entered as existing production/,
    'raw extraction belongs in the resource budgets',
  );
  assert.throws(
    () => calculate({ ...BASE, existingSupply: { 'Nonsense Widget': 5 } }),
    /cannot be entered as existing production/,
  );
  assert.throws(
    () => calculate({ ...BASE, existingSupply: { 'Modular Frame': -5 } }),
    /Enter a number/,
  );
  assert.throws(
    () => calculate({ ...BASE, existingSupply: [1, 2] }),
    /Invalid existing production rates/,
  );
  assert.throws(
    () =>
      calculate({
        ...BASE,
        existingSupply: Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => ['Modular Frame' + i, 1]),
        ),
      }),
    /existing production/,
  );
  // The catalog offers every craftable, non-raw item and no raw ones.
  const items = catalog().supplyItems;
  assert.ok(
    items.includes('Modular Frame') &&
      items.includes('Heavy Modular Frame') &&
      items.includes('Computer'),
  );
  assert.ok(
    !items.some(n => ['Iron Ore', 'Water', 'Crude Oil'].includes(n)),
    'raw resources are not offered here',
  );
  assert.deepEqual(
    [...items].sort((a, b) => a.localeCompare(b)),
    items,
    'offered in name order',
  );
});

test('the plan says what it credited and warns about the budgets', () => {
  const plan = calculate({ ...BASE, existingSupply: { 'Modular Frame': 50 } });
  const notice = plan.warnings.find(w => w.includes('production you already run'));
  assert.ok(notice, 'the assumption is stated');
  assert.match(notice, /Modular Frame/);
  assert.match(notice, /net of them/, 'and says the budgets must already exclude it');
  assert.equal(
    calculate(BASE).warnings.some(w => w.includes('production you already run')),
    false,
    'and is silent when nothing is declared',
  );
});

test('every guided question can be walked past, including the one that is not a choice', async () => {
  const context = ui();
  guided(context);
  context.formStub = {
    querySelector: (selector: string) => (selector === '.supply-list' ? {} : null),
    reportValidity: () => true,
  };
  vm.runInContext(
    `FormData=class{constructor(){}get(){return null;}getAll(){return [];}has(){return false;}*[Symbol.iterator](){}}`,
    context,
  );
  vm.runInContext(
    'render=()=>{};document={querySelector:()=>formStub,querySelectorAll:()=>[],addEventListener(){}};',
    context,
  );
  const total = vm.runInContext('guidedFlow().length', context);
  // Walking forward from each question in turn must land on the next one and
  // never throw: the supply question carries no options to look a hand-off up in.
  for (let step = 1; step < total; step++) {
    vm.runInContext(`wizard.guidedStep=${step}`, context);
    await vm.runInContext(`moveGuided(${step + 1})`, context);
    assert.equal(
      vm.runInContext('wizard.guidedStep', context),
      step + 1,
      'stuck leaving question ' + step,
    );
  }
});

test('a plan saved before existing production existed still renders every page', () => {
  const context = ui();
  // Exactly what a profile calculated by an earlier release looks like: no
  // existingSupply in its settings, no supplied on any stage.
  const legacy: StoredCalculatedPlan = structuredClone(
    calculate({ phase: '3', limitsConfirmed: true }),
  );
  delete legacy.settings.existingSupply;
  for (const stage of Object.values(legacy.stages)) delete stage.supplied;
  context.legacyPlan = legacy;
  vm.runInContext(
    `calculated=legacyPlan;currentProfile={id:'p',kind:'calculated',name:'Older profile'};state={settings:{phase:'3'},checks:{['calc-3-'+legacyPlan.stages['3'].rows[0].id]:true},notes:{},deliveries:{},customTasks:[]};`,
    context,
  );
  // The pages, and the wizard Review of such a plan, are components: tests/ui/ render them
  // for this shape too.
  // ADA reads the same counters and must not throw on the older shape.
  assert.doesNotThrow(() => vm.runInContext('adaFacts()', context));
  // And its progress is untouched by any of this.
  assert.equal(vm.runInContext(`Object.values(state.checks).filter(Boolean).length`, context), 1);
});

test('the item search ranks prefix matches first and stays short', () => {
  const context = ui();
  guided(context);
  const matches = (query: string) =>
    vm.runInContext(`JSON.stringify(supplyMatches(${JSON.stringify(query)}))`, context);
  assert.equal(matches(''), '[]', 'nothing typed, nothing offered');
  const frame = JSON.parse(matches('frame'));
  assert.ok(
    frame.includes('Modular Frame') && frame.includes('Heavy Modular Frame'),
    'substring matches are found',
  );
  const mod = JSON.parse(matches('mod'));
  assert.ok(
    mod[0].toLowerCase().startsWith('mod'),
    'a name starting with what you typed comes first, got ' + mod[0],
  );
  assert.ok(
    mod.indexOf('Modular Frame') < mod.indexOf('Heavy Modular Frame'),
    'before one that merely contains it',
  );
  assert.ok(JSON.parse(matches('e')).length <= 8, 'the list never runs away');
  assert.equal(JSON.parse(matches('MODULAR FRAME'))[0], 'Modular Frame', 'case does not matter');
  assert.equal(matches('nothing like this'), '[]');
});

test('a half-finished row survives, and is plainly not counted yet', () => {
  const context = ui();
  guided(context);
  vm.runInContext(`wizard.guidedStep=guidedFlow().findIndex(q=>q.id==='supply')+1`, context);
  const form = (rows: string[][]) => ({
    querySelector: (selector: string) => (selector === '.supply-list' ? {} : null),
    __rows: rows,
  });
  vm.runInContext(
    `FormData=class{constructor(f){this.f=f;}get(){return null;}getAll(k){return k==='supplyItem'?this.f.__rows.map(r=>r[0]):k==='supplyRate'?this.f.__rows.map(r=>r[1]):[];}has(){return false;}*[Symbol.iterator](){}}`,
    context,
  );
  context.formFor = form;
  // Picking a suggestion commits the name before there is any rate to go with
  // it; that row has to survive the redraw or the pick erases itself.
  // Through readGuided, which is the path the screen actually uses.
  const call = (rows: string[][]) =>
    `(f=>{readGuided(f);return JSON.stringify(wizard.settings.existingSupply);})(formFor(${JSON.stringify(rows)}))`;
  const kept = vm.runInContext(
    call([
      ['Modular Frame', ''],
      ['', ''],
    ]),
    context,
  );
  assert.equal(kept, '{}', 'nothing is credited without a rate');
  assert.equal(
    vm.runInContext('JSON.stringify(wizard.supplyRows)', context),
    '[{"name":"Modular Frame","rate":""}]',
    'but the row is still there',
  );
  // A name that is not an item is kept as typed but not credited (the row says why:
  // tests/ui/wizard.test.ts).
  vm.runInContext(
    call([
      ['Modul', '12'],
      ['', ''],
    ]),
    context,
  );
  assert.equal(vm.runInContext('JSON.stringify(wizard.settings.existingSupply)', context), '{}');
  // Completed, it counts.
  vm.runInContext(
    call([
      ['Modular Frame', '50'],
      ['', ''],
    ]),
    context,
  );
  assert.equal(
    vm.runInContext('JSON.stringify(wizard.settings.existingSupply)', context),
    '{"Modular Frame":50}',
  );
});

test('the icons the item search shows are bundled', () => {
  for (const name of ['Modular Frame', 'Plastic', 'Computer']) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    assert.ok(fs.existsSync(new URL('../public/icons/' + slug + '.png', import.meta.url)), name);
  }
});

// --- Working out budgets from nodes -----------------------------------------

// The survey for the default world: the wiki's node counts, mined the way the
// shipped budgets assume — Mk.3 miners at 250%.
const defaultSurvey = () => {
  const survey = blankExtraction();
  for (const [name, [impure, normal, pure]] of Object.entries(nodeCounts)) {
    // Nitrogen comes out of resource wells; everything else out of ordinary nodes.
    (name === 'Nitrogen Gas' ? survey.wells : survey.nodes)[name] = { impure, normal, pure };
  }
  return survey;
};

test('the extraction maths rebuilds the shipped budgets from the node counts', () => {
  const survey = defaultSurvey();
  for (const name of [...minedResources, 'Crude Oil', 'Nitrogen Gas']) {
    assert.equal(
      Math.round(resourcePool(survey, name)),
      DEFAULT_LIMITS[name],
      name + ' at Mk.3 and 250%',
    );
  }
  // Which also pins the per-purity rates: the whole table is one wrong number
  // away from failing here.
  assert.equal(nodeYield('Iron Ore', 'normal', { mark: 1, clock: 1 }), 60);
  assert.equal(nodeYield('Iron Ore', 'normal', { mark: 2, clock: 1 }), 120);
  assert.equal(nodeYield('Iron Ore', 'normal', { mark: 3, clock: 1 }), 240);
  assert.equal(nodeYield('Iron Ore', 'impure', { mark: 3, clock: 2.5 }), 300);
  assert.equal(nodeYield('Iron Ore', 'pure', { mark: 3, clock: 2.5 }), 1200);
  assert.equal(
    nodeYield('Crude Oil', 'normal', { clock: 2.5 }),
    300,
    'oil extractors are not miners',
  );
  assert.equal(wellYield('normal', { clock: 2.5 }), 150, 'well satellites are their own rate');
  // All-pure is the same nodes at pure, which is exactly the shipped pure table.
  const pure = blankExtraction();
  for (const [name, [impureCount, normalCount, pureCount]] of Object.entries(nodeCounts))
    (name === 'Nitrogen Gas' ? pure.wells : pure.nodes)[name] = {
      impure: 0,
      normal: 0,
      pure: impureCount + normalCount + pureCount,
    };
  for (const name of [...minedResources, 'Crude Oil', 'Nitrogen Gas']) {
    assert.equal(Math.round(resourcePool(pure, name)), PURE_LIMITS[name], name + ' all pure');
  }
});

test('the two shipped limit tables agree with the node counts they come from', () => {
  // Limestone used to be 69,900 here against 69,300 from its own 15/50/29 nodes.
  for (const name of Object.keys(nodeCounts)) {
    assert.equal(
      resourceDefaults('vanilla', 'original').limits[name],
      DEFAULT_LIMITS[name],
      name + ' default budget',
    );
  }
});

test('a survey becomes budgets, less what is already committed', () => {
  const survey = defaultSurvey();
  const full = extractionLimits(survey, { Water: 1000000 });
  assert.equal(full['Iron Ore'], 92100);
  assert.equal(full.Water, 1000000, 'water keeps its allowance rather than being counted');
  // Committed extraction comes off the top, which is what a budget means here.
  survey.used = { 'Iron Ore': 12100 };
  const left = extractionLimits(survey, { Water: 1000000 });
  assert.equal(left['Iron Ore'], 80000);
  assert.equal(left.Limestone, full.Limestone, 'and only off the resource it names');
  // Never negative, however much is claimed.
  survey.used = { 'Iron Ore': 1e9 };
  assert.equal(extractionLimits(survey, {})['Iron Ore'], 0);
  // The miner and clock scale everything.
  const mk1 = extractionLimits({ ...defaultSurvey(), mark: 1, clock: 1 }, {});
  assert.equal(mk1['Iron Ore'], 92100 / 10, 'Mk.1 at 100% is a tenth of Mk.3 at 250%');
  assert.equal(mk1['Crude Oil'], 9900 / 2.5, 'oil has no marks, so only the clock moves it');
});

test('the survey is recorded on the profile but never read by the solver', () => {
  const survey = defaultSurvey();
  const withSurvey = calculate({
    phase: '3',
    limitsConfirmed: true,
    extraction: survey,
    limits: { ...DEFAULT_LIMITS },
  });
  const without = calculate({ phase: '3', limitsConfirmed: true, limits: { ...DEFAULT_LIMITS } });
  assert.deepEqual(
    withSurvey.settings.extraction!.nodes['Iron Ore'],
    { impure: 39, normal: 42, pure: 46 },
    'it is kept',
  );
  assert.equal(strip(withSurvey), strip(without), 'and changes nothing about the plan');
  assert.equal(without.settings.extraction, null, 'absent by default');
  // Only real resources and sane counts are accepted.
  assert.throws(
    () => calculate({ extraction: { nodes: { 'Modular Frame': { normal: 1 } } } }),
    /not a raw resource/,
  );
  assert.throws(() => calculate({ extraction: { mark: 4 } }), /Invalid miner mark/);
  assert.throws(
    () => calculate({ extraction: { nodes: { 'Iron Ore': { normal: -1 } } } }),
    /Enter a number/,
  );
  assert.throws(() => calculate({ extraction: [1] }), /Invalid extraction survey/);
  assert.throws(() => calculate({ extraction: { used: { Nope: 5 } } }), /not a raw resource/);
});

// The survey screens themselves are tested in tests/ui/survey.test.ts.

test('applying the survey writes the budgets and confirms them', () => {
  const context = ui();
  guided(
    context,
    `wizard.mode='extraction';wizard.extractionStep=4;wizard.extractionReturn={mode:'advanced',step:4};wizard.extraction=${JSON.stringify(defaultSurvey())};wizard.settings.limitsConfirmed=false;`,
  );
  vm.runInContext(
    `render=()=>{};toast=()=>{};document={querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};`,
    context,
  );
  vm.runInContext('moveExtraction(5)', context);
  assert.equal(vm.runInContext(`wizard.settings.limits['Iron Ore']`, context), 92100);
  assert.equal(vm.runInContext(`wizard.settings.limits.Limestone`, context), 69300);
  assert.equal(
    vm.runInContext('wizard.settings.limitsConfirmed', context),
    true,
    'counted numbers are confirmed numbers',
  );
  assert.equal(vm.runInContext('wizard.preview', context), null, 'and the plan is recalculated');
  assert.equal(
    vm.runInContext('wizard.mode', context),
    'advanced',
    'returning where it was opened from',
  );
  assert.equal(vm.runInContext('wizard.step', context), 4);
  assert.equal(
    vm.runInContext(`JSON.stringify(wizard.settings.extraction.nodes['Iron Ore'])`, context),
    '{"impure":39,"normal":42,"pure":46}',
    'the survey is kept for next time',
  );
});

// The resource tables' ore icons: tests/ui/pages.test.ts.

test('every node preset reproduces that purity setting’s shipped budget', () => {
  // The purity settings shift nodes up and down the scale rather than adding or
  // removing any, so each preset is the known map count rearranged — and must
  // come back out as exactly the budget resourceDefaults already ships.
  for (const [purity] of nodePresets) {
    const survey = presetSurvey(purity);
    const want = resourceDefaults(purity, 'original').limits;
    for (const name of [...minedResources, 'Crude Oil', 'Nitrogen Gas']) {
      assert.equal(Math.round(resourcePool(survey, name)), want[name], purity + ' / ' + name);
    }
  }
  // The node total never changes; only which purity column holds it.
  for (const [purity] of nodePresets) {
    const survey = presetSurvey(purity);
    for (const [name, counts] of Object.entries(nodeCounts)) {
      const row = (name === 'Nitrogen Gas' ? survey.wells : survey.nodes)[name]!;
      assert.equal(
        row.impure + row.normal + row.pure,
        counts[0] + counts[1] + counts[2],
        purity + ' / ' + name + ' keeps its node count',
      );
    }
  }
  // The shifts themselves, spelled out on one resource.
  assert.deepEqual(presetCounts('vanilla', [15, 50, 29]), { impure: 15, normal: 50, pure: 29 });
  assert.deepEqual(presetCounts('pure', [15, 50, 29]), { impure: 0, normal: 0, pure: 94 });
  assert.deepEqual(presetCounts('normal', [15, 50, 29]), { impure: 0, normal: 94, pure: 0 });
  assert.deepEqual(presetCounts('impure', [15, 50, 29]), { impure: 94, normal: 0, pure: 0 });
  assert.deepEqual(
    presetCounts('mostly-pure', [15, 50, 29]),
    { impure: 0, normal: 15, pure: 79 },
    'each node moves up one level',
  );
  assert.deepEqual(
    presetCounts('mostly-impure', [15, 50, 29]),
    { impure: 65, normal: 29, pure: 0 },
    'and down one for mostly impure',
  );
});

test('a resource-rich world is described, never counted for the user', () => {
  // Direction is the only thing every published count of these worlds agrees
  // on, so it is the only thing the screen says. No numbers, and nothing filled.
  for (const distribution of ['basic', 'advanced', 'fossil']) {
    assert.ok(richShape[distribution], distribution + ' is described');
    assert.ok(!/[0-9]/.test(richShape[distribution]), distribution + ' promises no numbers');
    assert.equal(
      JSON.stringify(startingSurvey({ purity: 'pure', distribution: distribution }).nodes),
      '{}',
      distribution + ' fills nothing',
    );
    assert.equal(knownWorld('pure', distribution), false, distribution + ' is never knowable');
  }
  // The default and shuffled worlds are not described this way: they are counted.
  for (const distribution of ['original', 'randomized'])
    assert.equal(richShape[distribution], undefined, distribution);
});
test('well yields do not survive the shuffle, so Random leaves the wells alone', () => {
  // A well is randomized as a whole, and the map's seventeen wells hold
  // different numbers of satellites, so whichever resource lands on the
  // ten-satellite well gains and whichever lands on a six loses. The ordinary
  // nodes are unaffected: those are what the shuffle preserves.
  const original = presetSurvey('pure', null, 'original'),
    randomized = presetSurvey('pure', null, 'randomized');
  assert.deepEqual(randomized.nodes, original.nodes, 'ordinary nodes are the same either way');
  assert.equal(original.wells['Nitrogen Gas']!.pure, 45, 'default distribution fills nitrogen');
  assert.equal(randomized.wells['Nitrogen Gas'], undefined, 'Random does not');
  // The same holds for a survey started from the settings alone.
  assert.equal(
    JSON.stringify(startingSurvey({ purity: 'pure', distribution: 'randomized' }).wells),
    '{}',
  );
  assert.equal(startingSurvey({ purity: 'pure' }).wells['Nitrogen Gas']!.pure, 45);
  // A count the user already made is never overwritten by the preset.
  const mine = {
    ...blankExtraction(),
    wells: { 'Nitrogen Gas': { impure: 1, normal: 2, pure: 3 } },
  };
  assert.deepEqual(presetSurvey('pure', mine, 'randomized').wells['Nitrogen Gas'], {
    impure: 1,
    normal: 2,
    pure: 3,
  });
  // And which world the counts are is decided by the nodes, so a hand-counted
  // well does not stop the screen naming the preset.
  assert.equal(matchingPreset(presetSurvey('pure', mine, 'randomized')), 'pure');
});

test('Random shuffles where the nodes are, not how many of each there are', () => {
  // Random node randomization moves which resource sits at each location and
  // shuffles their purities with it, but every resource keeps its node count:
  // nineteen SAM nodes are still nineteen SAM nodes. So a uniform purity, where
  // the split stops mattering, is exactly the default map's totals.
  for (const purity of uniformPurities) {
    assert.equal(knownWorld(purity, 'randomized'), true, 'Random + ' + purity);
    assert.equal(
      Math.round(resourcePool(startingSurvey({ purity, distribution: 'randomized' }), 'Iron Ore')),
      Math.round(resourcePool(startingSurvey({ purity, distribution: 'original' }), 'Iron Ore')),
      'Random + ' + purity + ' matches the default map',
    );
  }
  // A purity that keeps the map's own split cannot survive the shuffle.
  for (const purity of ['vanilla', 'mostly-pure', 'mostly-impure'])
    assert.equal(knownWorld(purity, 'randomized'), false, 'Random + ' + purity);
  // And a resource-rich distribution is unknowable whatever the purity.
  for (const distribution of ['basic', 'advanced', 'fossil'])
    for (const purity of presetPurities)
      assert.equal(knownWorld(purity, distribution), false, distribution + ' + ' + purity);
  // Random with All Pure fills the ordinary nodes but not the wells; with the map's
  // own split it fills nothing. (What the screen says about each: tests/ui/survey.test.ts.)
  const pure = startingSurvey({ purity: 'pure', distribution: 'randomized' });
  assert.equal(pure.nodes['Iron Ore']!.pure, 127, 'filled from the shuffle-proof totals');
  assert.equal(JSON.stringify(pure.wells), '{}', 'nitrogen not filled under Random');
  assert.equal(
    JSON.stringify(startingSurvey({ purity: 'vanilla', distribution: 'randomized' }).nodes),
    '{}',
    'the split is missing, so nothing is filled in',
  );
});
test('changing a world setting refills the counts, and leaves alone what it cannot know', () => {
  // An oil well count is the user's own: the known table has none.
  const kept = blankExtraction();
  kept.wells = { 'Crude Oil': { impure: 0, normal: 6, pure: 0 } };
  kept.nodes = { 'Iron Ore': { impure: 39, normal: 42, pure: 46 } };
  const survey = presetSurvey('pure', kept);
  assert.equal(survey.wells['Crude Oil']!.normal, 6, 'the oil wells the user counted survive');
  assert.equal(survey.nodes['Iron Ore']!.pure, 127, 'and the rest is refilled');
  assert.equal(survey.nodes['Iron Ore']!.impure, 0);
  // Nitrogen is a well, so it is filled there rather than as a node.
  assert.equal(survey.nodes['Nitrogen Gas'], undefined);
  assert.equal(survey.wells['Nitrogen Gas']!.pure, 45);
  // And the counts now match that world, which the screen names.
  assert.equal(matchingPreset(survey), 'pure');
});
