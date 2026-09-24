import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createApp } from '../server.mjs';
import { calculate, catalog, DELIVERIES, DEFAULT_LIMITS, PURE_LIMITS } from '../planner.mjs';
import { nodeCounts } from '../public/preferences.js';
import { progression } from '../public/progression.js';
import { adaRemarks, adaEncore, adaFault as makeFault } from '../public/ada.js';
import { appSource } from './helpers/app-source.mjs';
import {
  carryOptions,
  pickedRecipeUnlocks,
  bayCapacity,
  bayOfSlot,
  slotPosition,
  newProfileState,
  initialState,
} from '../public/state.js';
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
} from '../public/preferences.js';

const source = appSource();
// The same VM harness the interface tests use: app.js runs with its imports
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
  const c = vm.createContext({
    document: {
      querySelector: () => node,
      querySelectorAll: () => [],
      addEventListener() {},
      activeElement: null,
    },
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: '#plan' },
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
  });
  vm.runInContext(source, c);
  c.fixture = JSON.parse(fs.readFileSync(new URL('../public/plan.json', import.meta.url), 'utf8'));
  c.catalogData = catalog();
  c.progressionFixture = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  c.generated = calculate({});
  vm.runInContext(
    `plan=fixture;progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World'};currentProfile={id:'p',kind:'calculated',name:'Balanced'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};calculated=generated;`,
    c,
  );
  return c;
}
const guided = (c, extra = '') =>
  vm.runInContext(
    `wizard={step:1,saveId:null,saveName:'World',name:'',settings:structuredClone(generated.settings),preview:null,carryFrom:null,carry:{},mode:'guided',guidedStep:1,guidedAsk:null,usedGuided:false,tutorial:'doing'};${extra}`,
    c,
  );

// The wizard and guided screens themselves: tests/ui/wizard.test.mjs.

test('guided answers write the same settings object the wizard writes', () => {
  const c = ui();
  guided(c);
  const form = answers => ({
    querySelector: s => (s === '.guided-topup' ? {} : null),
    entries: () => [],
    __answers: answers,
  });
  // FormData is not available in the harness, so drive readGuided through a stub
  // that answers exactly as the rendered radios would.
  vm.runInContext(
    `FormData=class{constructor(f){this.f=f;}get(k){return this.f.__answers[k]??null;}getAll(k){const v=this.f.__answers[k];return v===undefined?[]:[].concat(v);}has(k){return this.f.__answers[k]!==undefined;}}`,
    c,
  );
  c.formFor = form;
  vm.runInContext(
    `readGuided(formFor({'guided:phase':'4','guided:goal':'minimal','guided:recipes':'all','guided:stock':'construction','guided:exact':'precise',topup:['Concrete','Iron Rod']}))`,
    c,
  );
  const s = vm.runInContext('JSON.parse(JSON.stringify(wizard.settings))', c);
  assert.equal(s.phase, '4');
  assert.equal(s.goal, 'minimal');
  assert.equal(s.recipes, 'all');
  assert.equal(s.storage, 'construction');
  assert.equal(s.wholeMachines, false);
  // The general construction rate is the most expensive control in the app and
  // the guided start never raises it; the per-item floors do the same job.
  assert.equal(s.buildRate, 1);
  assert.equal(s.storageRate, 1);
  assert.deepEqual(s.storageOverrides, {
    Concrete: GUIDED_TOPUP_RATE,
    'Iron Rod': GUIDED_TOPUP_RATE,
  });
  // And the result is a settings object the planner accepts unchanged.
  const plan = calculate(s);
  assert.equal(plan.settings.phase, '4');
  assert.equal(plan.settings.storageOverrides.Concrete, GUIDED_TOPUP_RATE);
  assert.equal(plan.stages[4].feasible, true);
});

test('switching to All settings keeps every guided answer and can switch back', () => {
  const c = ui();
  guided(c);
  vm.runInContext(
    `FormData=class{constructor(){}get(){return null;}getAll(){return [];}has(){return false;}*[Symbol.iterator](){}}`,
    c,
  );
  vm.runInContext(`wizard.settings.goal='minimal';wizard.settings.phase='5';toAdvanced(3)`, c);
  assert.equal(vm.runInContext('wizard.mode', c), 'advanced');
  assert.equal(vm.runInContext('wizard.step', c), 3, 'lands on the step that owns the question');
  assert.equal(vm.runInContext('wizard.settings.goal', c), 'minimal', 'answers survive the switch');
  assert.equal(vm.runInContext('wizard.settings.phase', c), '5');
  vm.runInContext('toGuided()', c);
  assert.equal(vm.runInContext('wizard.mode', c), 'guided');
  assert.equal(vm.runInContext('wizard.settings.goal', c), 'minimal');
});

test('the tutorial question is asked at Phase 1 and the already-running one after it', () => {
  const c = ui();
  guided(c);
  vm.runInContext(`wizard.settings.phase='1'`, c);
  assert.equal(
    vm.runInContext(`guidedFlow().map(q=>q.id).join(',')`, c),
    'phase,tutorial,goal,recipes,stock,exact',
  );
  vm.runInContext(`wizard.settings.phase='3'`, c);
  assert.equal(
    vm.runInContext(`guidedFlow().map(q=>q.id).join(',')`, c),
    'phase,supply,goal,recipes,stock,exact',
  );
  // A save that already has profiles uses the Review step's carry panel instead.
  vm.runInContext(`wizard.saveId='s1'`, c);
  assert.equal(
    vm.runInContext(`guidedFlow().map(q=>q.id).join(',')`, c),
    'phase,goal,recipes,stock,exact',
  );
});

test('a second profile for a save you already play is asked what changed, not everything again', () => {
  const c = ui();
  vm.runInContext(
    `workspace.saves=[{id:'s1',name:'World',activeProfile:'p1',profiles:[{id:'p1',name:'First run',kind:'calculated'}]}];`,
    c,
  );
  guided(c, `wizard.saveId='s1';wizard.saveName='World';wizard.carryFrom='p1';`);
  // Nothing chosen yet: the topic picker comes first, and asks every question it offers.
  assert.equal(vm.runInContext('wizard.guidedAsk', c), null);
  // Choosing only the phase asks only the phase.
  vm.runInContext(`wizard.guidedAsk=['phase']`, c);
  assert.equal(vm.runInContext("guidedFlow().map(q=>q.id).join(',')", c), 'phase');
});

test('a new profile without a list of finished work is exactly the blank state as before', () => {
  const plan = calculate({ phase: '3' });
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
  const row = plan.stages[3].rows[0].id;
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
  const row = plan.stages[3].rows[0].id,
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
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (ep, b) =>
    fetch(url + ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(b),
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
    const built = plan.stages[3].rows.slice(0, 4).map(r => 'calc-3-' + r.id);
    const created = await post('/api/profiles', {
      saveName: 'Guided world',
      name: 'Guided',
      settings,
      built,
    }).then(r => r.json());
    assert.ok(created.profileId);
    assert.equal(created.carriedChecks, 4, 'the marked lines are reported back');
    const ctx = await fetch(
      url + '/api/context?save=' + created.saveId + '&profile=' + created.profileId,
    ).then(r => r.json());
    for (const key of built) assert.equal(ctx.state.checks[key], true, key);
    assert.equal(
      Object.values(ctx.state.checks).filter(Boolean).length,
      4,
      'and nothing else is ticked',
    );
    assert.equal(ctx.plan.settings.storageOverrides.Concrete, GUIDED_TOPUP_RATE);
    // A profile made without the new field is still the blank state.
    const plain = await post('/api/profiles', {
      saveId: created.saveId,
      name: 'Plain',
      settings,
    }).then(r => r.json());
    const ctx2 = await fetch(
      url + '/api/context?save=' + created.saveId + '&profile=' + plain.profileId,
    ).then(r => r.json());
    assert.deepEqual(ctx2.state.checks, {});
  } finally {
    await new Promise(r => server.close(r));
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the phase cards use bundled, attributed artwork that matches the deliveries', () => {
  const sources = JSON.parse(
    fs.readFileSync(new URL('../public/icons/sources.json', import.meta.url)),
  );
  for (const [phase, parts] of Object.entries(phaseParts)) {
    assert.deepEqual(
      [...parts].sort(),
      Object.keys(DELIVERIES[phase]).sort(),
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
  for (const q of [...guidedQuestions, guidedStandingQuestion('1'), guidedStandingQuestion('3')]) {
    assert.ok(q.title && q.lead, q.id + ' reads as a question');
    assert.ok(q.short && q.short.length <= 20, q.id + ' has a short name for the progress strip');
    assert.ok(q.step >= 1 && q.step <= 4, q.id + ' names the advanced step that owns it');
    // One question is an input rather than a choice; the rest are picture cards.
    if (q.kind === 'supply') {
      assert.ok(!q.options, q.id);
      continue;
    }
    assert.ok(q.options.length >= 2, q.id);
    for (const o of q.options) {
      assert.ok(o.label && o.detail, q.id + '/' + o.value + ' is a picture and a sentence');
      assert.ok(o.items || o.glyph, q.id + '/' + o.value + ' has artwork');
      assert.ok(o.set && typeof o.set === 'object', q.id + '/' + o.value + ' says what it sets');
      seen.add(q.id + ':' + o.value);
    }
  }
  assert.ok(seen.size >= 15);
  // Every option's settings patch, applied on its own, is a plan the planner makes.
  for (const q of guidedQuestions)
    for (const o of q.options) {
      if (o.handoff) continue;
      assert.doesNotThrow(
        () => calculate({ phase: '3', limitsConfirmed: true, ...o.set }),
        q.id + '/' + o.value,
      );
    }
});

test('ADA has something to say about the guided start', () => {
  const ids = f => new Set(adaRemarks(f).map(r => r.id));
  assert.ok(ids({ view: 'wizard', guided: true, guidedStep: 2, guidedTotal: 6 }).has('guided'));
  assert.ok(ids({ view: 'wizard', supplyDeclared: 2 }).has('guided-supply'));
  assert.ok(ids({ view: 'wizard', tutorialDone: true }).has('guided-tutorial'));
  // The remark repeats the plan's own promise and never claims the plan changed.
  const supply = adaRemarks({ view: 'wizard', supplyDeclared: 2 }).find(
    r => r.id === 'guided-supply',
  );
  assert.match(supply.text, /2 lines/);
  assert.match(supply.text, /skip the chain behind them/);
  // The existing wizard remark still leads a plain wizard view.
  assert.ok(!ids({ view: 'wizard' }).has('guided'), 'nothing fires without the guided flow');
});

test('the only progress a guided answer can tick is the HUB tutorial', () => {
  const c = ui();
  guided(c, `wizard.step=5;wizard.guidedStep=99;wizard.preview=generated;`);
  // Everything else the guided start learns is a rate, which changes the plan
  // rather than its progress — so there is no production line to pre-tick and no
  // way to claim work the user did not do.
  assert.equal(vm.runInContext('guidedBuiltKeys(wizard).length', c), 0);
  vm.runInContext(`wizard.settings.existingSupply={'Modular Frame':50};`, c);
  assert.equal(
    vm.runInContext('guidedBuiltKeys(wizard).length', c),
    0,
    'declaring a line ticks nothing',
  );
  vm.runInContext(`wizard.tutorial='done'`, c);
  assert.equal(vm.runInContext('guidedBuiltKeys(wizard).join(",")', c), tutorialKeys.join(','));
});

test('leaving the "what is different" screen starts the questions it chose', async () => {
  const c = ui();
  vm.runInContext(
    `workspace.saves=[{id:'s1',name:'World',activeProfile:'p1',profiles:[{id:'p1',name:'First run',kind:'calculated'}]}];`,
    c,
  );
  guided(c, `wizard.saveId='s1';wizard.saveName='World';wizard.carryFrom='p1';`);
  vm.runInContext(
    `FormData=class{constructor(f){this.f=f;}get(){return null;}getAll(k){return k==='topic'?['phase','goal']:[];}has(){return false;}*[Symbol.iterator](){}}`,
    c,
  );
  // $('#wizard-form') reads document.querySelector, so stand a form in for it.
  c.formStub = {
    querySelector: s => (s === '.guided-topics' ? {} : null),
    reportValidity: () => true,
  };
  vm.runInContext(
    'render=()=>{};document={querySelector:()=>formStub,querySelectorAll:()=>[],addEventListener(){}};',
    c,
  );
  await vm.runInContext('moveGuided(2)', c);
  assert.equal(
    vm.runInContext('wizard.guidedStep', c),
    1,
    'it starts at the first chosen question, not past it',
  );
  assert.equal(vm.runInContext(`wizard.guidedAsk.join(',')`, c), 'phase,goal');
  assert.equal(vm.runInContext('guidedFlow().length', c), 2);
  assert.equal(vm.runInContext('wizard.mode', c), 'guided', 'and it has not calculated yet');
});

// --- Production you already run ---------------------------------------------
const strip = p => JSON.stringify(p.stages, (k, v) => (k === 'createdAt' ? undefined : v));
const machines = st => (st.feasible ? (st.rows || []).reduce((a, r) => a + r.machines, 0) : null);
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
  const legacy = { ...absent.settings };
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
  assert.ok(machines(stage) < machines(before.stages[3]), 'fewer buildings');
  // The point of a rate rather than a tick: the ore behind it goes too.
  assert.ok(
    stage.raw['Iron Ore'] < before.stages[3].raw['Iron Ore'] - 100,
    'the iron behind it is not mined either',
  );
  assert.ok(stage.requiredMW < before.stages[3].requiredMW, 'and its power is not budgeted');
  // It draws only what the plan needs, never the whole declared rate.
  assert.ok(stage.supplied['Modular Frame'] > 0 && stage.supplied['Modular Frame'] <= 50);
  const plenty = calculate({ ...BASE, existingSupply: { 'Modular Frame': 5000 } });
  assert.equal(
    plenty.stages[3].supplied['Modular Frame'],
    stage.supplied['Modular Frame'],
    'declaring more than the plan uses changes nothing further',
  );
});

test('a partial rate is credited and the remainder is still planned', () => {
  const some = calculate({ ...BASE, existingSupply: { 'Modular Frame': 10 } });
  const stage = some.stages[3];
  assert.equal(stage.supplied['Modular Frame'], 10, 'all of it is used');
  assert.ok(
    (stage.rows || []).some(r => r.outputs['Modular Frame']),
    'and the rest is still built',
  );
  assert.ok(machines(stage) < machines(calculate(BASE).stages[3]));
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
  ]) {
    const p = calculate({ ...BASE, existingSupply: { [item]: rate } });
    for (const ph of ['3', '4', '5'])
      assert.equal(p.stages[ph].feasible, true, item + ' made phase ' + ph + ' infeasible');
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
  const p = calculate({ ...BASE, existingSupply: { 'Modular Frame': 50 } });
  const notice = p.warnings.find(w => w.includes('production you already run'));
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
  const c = ui();
  guided(c);
  c.formStub = {
    querySelector: s => (s === '.supply-list' ? {} : null),
    reportValidity: () => true,
  };
  vm.runInContext(
    `FormData=class{constructor(){}get(){return null;}getAll(){return [];}has(){return false;}*[Symbol.iterator](){}}`,
    c,
  );
  vm.runInContext(
    'render=()=>{};document={querySelector:()=>formStub,querySelectorAll:()=>[],addEventListener(){}};',
    c,
  );
  const total = vm.runInContext('guidedFlow().length', c);
  // Walking forward from each question in turn must land on the next one and
  // never throw: the supply question carries no options to look a hand-off up in.
  for (let step = 1; step < total; step++) {
    vm.runInContext(`wizard.guidedStep=${step}`, c);
    await vm.runInContext(`moveGuided(${step + 1})`, c);
    assert.equal(
      vm.runInContext('wizard.guidedStep', c),
      step + 1,
      'stuck leaving question ' + step,
    );
  }
});

test('a plan saved before existing production existed still renders every page', () => {
  const c = ui();
  // Exactly what a profile calculated by an earlier release looks like: no
  // existingSupply in its settings, no supplied on any stage.
  const legacy = structuredClone(calculate({ phase: '3', limitsConfirmed: true }));
  delete legacy.settings.existingSupply;
  for (const stage of Object.values(legacy.stages)) delete stage.supplied;
  c.legacyPlan = legacy;
  vm.runInContext(
    `calculated=legacyPlan;currentProfile={id:'p',kind:'calculated',name:'Older profile'};state={settings:{phase:'3'},checks:{['calc-3-'+legacyPlan.stages['3'].rows[0].id]:true},notes:{},deliveries:{},customTasks:[]};`,
    c,
  );
  // The pages, and the wizard Review of such a plan, are components: tests/ui/ render them
  // for this shape too.
  // ADA reads the same counters and must not throw on the older shape.
  assert.doesNotThrow(() => vm.runInContext('adaFacts()', c));
  // And its progress is untouched by any of this.
  assert.equal(vm.runInContext(`Object.values(state.checks).filter(Boolean).length`, c), 1);
});

test('the item search ranks prefix matches first and stays short', () => {
  const c = ui();
  guided(c);
  const matches = q => vm.runInContext(`JSON.stringify(supplyMatches(${JSON.stringify(q)}))`, c);
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
  const c = ui();
  guided(c);
  vm.runInContext(`wizard.guidedStep=guidedFlow().findIndex(q=>q.id==='supply')+1`, c);
  const form = rows => ({ querySelector: s => (s === '.supply-list' ? {} : null), __rows: rows });
  vm.runInContext(
    `FormData=class{constructor(f){this.f=f;}get(){return null;}getAll(k){return k==='supplyItem'?this.f.__rows.map(r=>r[0]):k==='supplyRate'?this.f.__rows.map(r=>r[1]):[];}has(){return false;}*[Symbol.iterator](){}}`,
    c,
  );
  c.formFor = form;
  // Picking a suggestion commits the name before there is any rate to go with
  // it; that row has to survive the redraw or the pick erases itself.
  // Through readGuided, which is the path the screen actually uses.
  const call = rows =>
    `(f=>{readGuided(f);return JSON.stringify(wizard.settings.existingSupply);})(formFor(${JSON.stringify(rows)}))`;
  const kept = vm.runInContext(
    call([
      ['Modular Frame', ''],
      ['', ''],
    ]),
    c,
  );
  assert.equal(kept, '{}', 'nothing is credited without a rate');
  assert.equal(
    vm.runInContext('JSON.stringify(wizard.supplyRows)', c),
    '[{"name":"Modular Frame","rate":""}]',
    'but the row is still there',
  );
  // A name that is not an item is kept as typed but not credited (the row says why:
  // tests/ui/wizard.test.mjs).
  vm.runInContext(
    call([
      ['Modul', '12'],
      ['', ''],
    ]),
    c,
  );
  assert.equal(vm.runInContext('JSON.stringify(wizard.settings.existingSupply)', c), '{}');
  // Completed, it counts.
  vm.runInContext(
    call([
      ['Modular Frame', '50'],
      ['', ''],
    ]),
    c,
  );
  assert.equal(
    vm.runInContext('JSON.stringify(wizard.settings.existingSupply)', c),
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
  const e = blankExtraction();
  for (const [name, [impure, normal, pure]] of Object.entries(nodeCounts)) {
    // Nitrogen comes out of resource wells; everything else out of ordinary nodes.
    (name === 'Nitrogen Gas' ? e.wells : e.nodes)[name] = { impure, normal, pure };
  }
  return e;
};

test('the extraction maths rebuilds the shipped budgets from the node counts', () => {
  const e = defaultSurvey();
  for (const name of [...minedResources, 'Crude Oil', 'Nitrogen Gas']) {
    assert.equal(
      Math.round(resourcePool(e, name)),
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
  for (const [name, [i, n, p]] of Object.entries(nodeCounts))
    (name === 'Nitrogen Gas' ? pure.wells : pure.nodes)[name] = {
      impure: 0,
      normal: 0,
      pure: i + n + p,
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
  const e = defaultSurvey();
  const full = extractionLimits(e, { Water: 1000000 });
  assert.equal(full['Iron Ore'], 92100);
  assert.equal(full.Water, 1000000, 'water keeps its allowance rather than being counted');
  // Committed extraction comes off the top, which is what a budget means here.
  e.used = { 'Iron Ore': 12100 };
  const left = extractionLimits(e, { Water: 1000000 });
  assert.equal(left['Iron Ore'], 80000);
  assert.equal(left.Limestone, full.Limestone, 'and only off the resource it names');
  // Never negative, however much is claimed.
  e.used = { 'Iron Ore': 1e9 };
  assert.equal(extractionLimits(e, {})['Iron Ore'], 0);
  // The miner and clock scale everything.
  const mk1 = extractionLimits({ ...defaultSurvey(), mark: 1, clock: 1 }, {});
  assert.equal(mk1['Iron Ore'], 92100 / 10, 'Mk.1 at 100% is a tenth of Mk.3 at 250%');
  assert.equal(mk1['Crude Oil'], 9900 / 2.5, 'oil has no marks, so only the clock moves it');
});

test('the survey is recorded on the profile but never read by the solver', () => {
  const e = defaultSurvey();
  const withSurvey = calculate({
    phase: '3',
    limitsConfirmed: true,
    extraction: e,
    limits: { ...DEFAULT_LIMITS },
  });
  const without = calculate({ phase: '3', limitsConfirmed: true, limits: { ...DEFAULT_LIMITS } });
  assert.deepEqual(
    withSurvey.settings.extraction.nodes['Iron Ore'],
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

// The survey screens themselves are tested in tests/ui/survey.test.mjs.

test('applying the survey writes the budgets and confirms them', () => {
  const c = ui();
  guided(
    c,
    `wizard.mode='extraction';wizard.extractionStep=4;wizard.extractionReturn={mode:'advanced',step:4};wizard.extraction=${JSON.stringify(defaultSurvey())};wizard.settings.limitsConfirmed=false;`,
  );
  vm.runInContext(
    `render=()=>{};toast=()=>{};document={querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};`,
    c,
  );
  vm.runInContext('moveExtraction(5)', c);
  assert.equal(vm.runInContext(`wizard.settings.limits['Iron Ore']`, c), 92100);
  assert.equal(vm.runInContext(`wizard.settings.limits.Limestone`, c), 69300);
  assert.equal(
    vm.runInContext('wizard.settings.limitsConfirmed', c),
    true,
    'counted numbers are confirmed numbers',
  );
  assert.equal(vm.runInContext('wizard.preview', c), null, 'and the plan is recalculated');
  assert.equal(vm.runInContext('wizard.mode', c), 'advanced', 'returning where it was opened from');
  assert.equal(vm.runInContext('wizard.step', c), 4);
  assert.equal(
    vm.runInContext(`JSON.stringify(wizard.settings.extraction.nodes['Iron Ore'])`, c),
    '{"impure":39,"normal":42,"pure":46}',
    'the survey is kept for next time',
  );
});

// The resource tables' ore icons: tests/ui/pages.test.mjs.

test('every node preset reproduces that purity setting’s shipped budget', () => {
  // The purity settings shift nodes up and down the scale rather than adding or
  // removing any, so each preset is the known map count rearranged — and must
  // come back out as exactly the budget resourceDefaults already ships.
  for (const [purity] of nodePresets) {
    const e = presetSurvey(purity);
    const want = resourceDefaults(purity, 'original').limits;
    for (const name of [...minedResources, 'Crude Oil', 'Nitrogen Gas']) {
      assert.equal(Math.round(resourcePool(e, name)), want[name], purity + ' / ' + name);
    }
  }
  // The node total never changes; only which purity column holds it.
  for (const [purity] of nodePresets) {
    const e = presetSurvey(purity);
    for (const [name, counts] of Object.entries(nodeCounts)) {
      const row = (name === 'Nitrogen Gas' ? e.wells : e.nodes)[name];
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
  for (const d of ['basic', 'advanced', 'fossil']) {
    assert.ok(richShape[d], d + ' is described');
    assert.ok(!/[0-9]/.test(richShape[d]), d + ' promises no numbers');
    assert.equal(
      JSON.stringify(startingSurvey({ purity: 'pure', distribution: d }).nodes),
      '{}',
      d + ' fills nothing',
    );
    assert.equal(knownWorld('pure', d), false, d + ' is never knowable');
  }
  // The default and shuffled worlds are not described this way: they are counted.
  for (const d of ['original', 'randomized']) assert.equal(richShape[d], undefined, d);
});
test('well yields do not survive the shuffle, so Random leaves the wells alone', () => {
  // A well is randomized as a whole, and the map's seventeen wells hold
  // different numbers of satellites, so whichever resource lands on the
  // ten-satellite well gains and whichever lands on a six loses. The ordinary
  // nodes are unaffected: those are what the shuffle preserves.
  const def = presetSurvey('pure', null, 'original'),
    rnd = presetSurvey('pure', null, 'randomized');
  assert.deepEqual(rnd.nodes, def.nodes, 'ordinary nodes are the same either way');
  assert.equal(def.wells['Nitrogen Gas'].pure, 45, 'default distribution fills nitrogen');
  assert.equal(rnd.wells['Nitrogen Gas'], undefined, 'Random does not');
  // The same holds for a survey started from the settings alone.
  assert.equal(
    JSON.stringify(startingSurvey({ purity: 'pure', distribution: 'randomized' }).wells),
    '{}',
  );
  assert.equal(startingSurvey({ purity: 'pure' }).wells['Nitrogen Gas'].pure, 45);
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
  for (const d of ['basic', 'advanced', 'fossil'])
    for (const purity of presetPurities)
      assert.equal(knownWorld(purity, d), false, d + ' + ' + purity);
  // Random with All Pure fills the ordinary nodes but not the wells; with the map's
  // own split it fills nothing. (What the screen says about each: tests/ui/survey.test.mjs.)
  const pure = startingSurvey({ purity: 'pure', distribution: 'randomized' });
  assert.equal(pure.nodes['Iron Ore'].pure, 127, 'filled from the shuffle-proof totals');
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
  const e = presetSurvey('pure', kept);
  assert.equal(e.wells['Crude Oil'].normal, 6, 'the oil wells the user counted survive');
  assert.equal(e.nodes['Iron Ore'].pure, 127, 'and the rest is refilled');
  assert.equal(e.nodes['Iron Ore'].impure, 0);
  // Nitrogen is a well, so it is filled there rather than as a node.
  assert.equal(e.nodes['Nitrogen Gas'], undefined);
  assert.equal(e.wells['Nitrogen Gas'].pure, 45);
  // And the counts now match that world, which the screen names.
  assert.equal(matchingPreset(e), 'pure');
});
