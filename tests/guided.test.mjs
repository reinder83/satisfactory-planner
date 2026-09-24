import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createApp } from '../server.mjs';
import { calculate, catalog, DELIVERIES, DEFAULT_LIMITS, PURE_LIMITS, RAW } from '../planner.mjs';
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
  const clickHandlers = [];
  const c = vm.createContext({
    document: {
      querySelector: () => node,
      querySelectorAll: () => [],
      addEventListener(type, fn) {
        if (type === 'click') clickHandlers.push(fn);
      },
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
  c.clickHandlers = clickHandlers;
  vm.runInContext(
    `plan=fixture;progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World'};currentProfile={id:'p',kind:'calculated',name:'Balanced'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};calculated=generated;`,
    c,
  );
  return c;
}
// Press a delegated button the way a browser would: the app's own listener,
// reached through e.target.closest('button').
async function clickButton(c, attr, data = {}) {
  const el = {
    tagName: 'BUTTON',
    dataset: data,
    hasAttribute: n => n === attr || n in data,
    getAttribute: n => data[n] ?? null,
    closest: s => (s === 'button' ? el : null),
    disabled: false,
  };
  assert.ok(c.clickHandlers.length, 'the app registered a click listener');
  for (const fn of c.clickHandlers)
    await fn({ target: el, preventDefault() {}, stopPropagation() {} });
}

const guided = (c, extra = '') =>
  vm.runInContext(
    `wizard={step:1,saveId:null,saveName:'World',name:'',settings:structuredClone(generated.settings),preview:null,carryFrom:null,carry:{},mode:'guided',guidedStep:1,guidedAsk:null,usedGuided:false,tutorial:'doing'};${extra}`,
    c,
  );

test('the guided start asks a short sequence and every screen offers All settings', () => {
  const c = ui();
  guided(c);
  const total = vm.runInContext('guidedFlow().length', c);
  assert.ok(total >= 5 && total <= 7, 'a handful of questions, not a form: ' + total);
  // Counted for the record: what the guided start replaces.
  assert.ok(guidedQuestions.length < 10);
  for (let step = 1; step <= total; step++) {
    const html = vm.runInContext(`wizard.guidedStep=${step};renderWizard()`, c);
    assert.ok(html.includes('wizard-form'), 'step ' + step + ' renders the shared form');
    assert.ok(
      html.includes('guided-card') || html.includes('supply-list'),
      'step ' + step + ' renders cards, or the rate rows for the one question that is not a choice',
    );
    assert.match(html, /data-guided-advanced="[1-4]"/, 'step ' + step + ' offers All settings');
    assert.ok(html.includes('guided-progress'), 'step ' + step + ' shows where you are');
  }
  // The escape hatch points at the advanced step that owns the same settings.
  vm.runInContext('wizard.guidedStep=1', c);
  assert.match(vm.runInContext('renderWizard()', c), /data-guided-advanced="1"/);
  const goalStep = vm.runInContext(`guidedFlow().findIndex(q=>q.id==='goal')+1`, c);
  assert.match(
    vm.runInContext(`wizard.guidedStep=${goalStep};renderWizard()`, c),
    /data-guided-advanced="3"/,
  );
});

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
  const advanced = vm.runInContext('renderWizard()', c);
  assert.ok(advanced.includes('wizard-progress'), 'the five-step wizard is intact');
  assert.ok(advanced.includes('data-guided-start'), 'and offers the way back');
  vm.runInContext('toGuided()', c);
  assert.equal(vm.runInContext('wizard.mode', c), 'guided');
  assert.equal(vm.runInContext('wizard.settings.goal', c), 'minimal');
});

test('the advanced wizard is unchanged when nothing asks for the guided start', () => {
  const c = ui();
  // A wizard object without a mode is what earlier releases and the existing
  // tests build; it must still render the five-step form.
  vm.runInContext(
    `wizard={step:1,saveName:'World',name:'Balanced',settings:structuredClone(generated.settings),preview:generated};`,
    c,
  );
  for (let step = 1; step <= 5; step++) {
    const html = vm.runInContext(`wizard.step=${step};renderWizard()`, c);
    assert.ok(html.includes('wizard-form'));
    assert.ok(!html.includes('guided-card'), 'step ' + step + ' shows no guided cards');
    assert.equal((html.match(/data-wizard-step=/g) || []).length, 5);
  }
  assert.match(vm.runInContext('wizard.step=4;renderWizard()', c), /limitsConfirmed/);
  assert.match(
    vm.runInContext('wizard.step=2;renderWizard()', c),
    /name="storageRate"/,
    'the rate boxes are still there',
  );
  assert.match(
    vm.runInContext('wizard.step=2;renderWizard()', c),
    /name="somersloops"/,
    'and the somersloop ledger',
  );
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
  const html = vm.runInContext('renderWizard()', c);
  assert.ok(html.includes('guided-topics'), 'the topic picker is shown first');
  assert.ok(html.includes('First run'), 'and names the profile it starts from');
  assert.ok(html.includes('guided-known'), 'with the settings it is keeping');
  // Choosing only the phase asks only the phase.
  vm.runInContext(`wizard.guidedAsk=['phase']`, c);
  assert.equal(vm.runInContext("guidedFlow().map(q=>q.id).join(',')", c), 'phase');
  assert.ok(vm.runInContext('renderWizard()', c).includes('guided-card'));
});

test('the already-running question asks for a rate, not a tick against the plan', () => {
  const c = ui();
  guided(c);
  const step = vm.runInContext(`guidedFlow().findIndex(q=>q.id==='supply')+1`, c);
  const html = vm.runInContext(`wizard.guidedStep=${step};renderWizard()`, c);
  assert.ok(html.includes('supply-list'), 'the rate rows are shown');
  assert.ok(!html.includes('guided-card'), 'this question has no cards to pick from');
  assert.ok(
    html.includes('placeholder="Search item"'),
    'the item field reads as a search, not as example data',
  );
  assert.ok(!html.includes('placeholder="50"'), 'and the rate carries no placeholder of its own');
  assert.ok(
    !html.includes('<datalist'),
    'suggestions are drawn in the page, not by browser chrome',
  );
  assert.ok(
    html.includes('class="supply-options"') && html.includes('role="listbox"'),
    'with a list we own',
  );
  assert.equal((html.match(/name="supplyItem"/g) || []).length, 1, 'one blank row to start');
  // A declared line gets its own row plus a fresh blank one and a way out.
  vm.runInContext(
    `wizard.settings.existingSupply={'Modular Frame':50};delete wizard.supplyRows;`,
    c,
  );
  const filled = vm.runInContext('renderWizard()', c);
  assert.equal(
    (filled.match(/name="supplyItem"/g) || []).length,
    2,
    'the declared line plus a blank row',
  );
  assert.ok(filled.includes('value="Modular Frame"') && filled.includes('value="50"'));
  assert.ok(
    filled.includes('data-supply-remove="0"'),
    'and can be removed by position, since a half-finished row has no name',
  );
  // It says plainly what it does to the plan and to the budgets.
  assert.match(filled, /builds only the remainder/i);
  assert.match(filled, /net of them/i);
  // All settings owns the same control, so switching modes is continuous.
  const advanced = vm.runInContext(`wizard.mode='advanced';wizard.step=1;renderWizard()`, c);
  assert.ok(advanced.includes('supply-list'), 'All settings step 1 has it too');
  assert.ok(advanced.includes('value="Modular Frame"'));
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
  // The topic picker is guided step 1 while nothing has been chosen yet.
  assert.ok(vm.runInContext('renderWizard()', c).includes('guided-topics'));
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
  // The other pages are components: tests/ui/ render them for this shape too.
  for (const view of ['renderCalculatedResources']) {
    const html = vm.runInContext(view + '()', c);
    assert.ok(typeof html === 'string' && html.length > 100, view + ' rendered nothing');
  }
  // The resources page says there is nothing credited rather than breaking.
  assert.match(vm.runInContext('renderCalculatedResources()', c), /None credited in this phase/);
  // ADA reads the same counters and must not throw on the older shape.
  assert.doesNotThrow(() => vm.runInContext('adaFacts()', c));
  // Review of an older plan shows no credit notice at all.
  vm.runInContext(
    `wizard={step:5,saveId:null,saveName:'W',name:'Older',settings:legacyPlan.settings,preview:legacyPlan,carryFrom:null,carry:{},mode:'advanced',guidedStep:1,guidedAsk:null,tutorial:'doing'};`,
    c,
  );
  assert.ok(!vm.runInContext('renderWizard()', c).includes('supply-notice'));
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
  const html = vm.runInContext('renderWizard()', c);
  assert.ok(html.includes('value="Modular Frame"'), 'and still on screen');
  assert.match(html, /Add a rate and this line is credited/, 'saying why it does not count yet');
  // A name that is not an item says so rather than being silently dropped.
  vm.runInContext(
    call([
      ['Modul', '12'],
      ['', ''],
    ]),
    c,
  );
  assert.match(vm.runInContext('renderWizard()', c), /No item of that name/);
  assert.equal(vm.runInContext('JSON.stringify(wizard.settings.existingSupply)', c), '{}');
  // Completed, it counts and the hint goes away.
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
  assert.ok(!vm.runInContext('renderWizard()', c).includes('supply-hint'));
});

test('every supply row reserves the same columns, so the fields line up', () => {
  const c = ui();
  guided(c);
  vm.runInContext(
    `wizard.guidedStep=guidedFlow().findIndex(q=>q.id==='supply')+1;wizard.settings.existingSupply={'Computer':20};delete wizard.supplyRows;`,
    c,
  );
  const html = vm.runInContext('renderWizard()', c);
  const rows = html.match(/class="supply-row"/g) || [];
  assert.equal(rows.length, 2, 'the declared line plus a blank one');
  // A row that sizes its third column to something narrower than the button
  // pushes its inputs out of line with the row above, so every row carries one.
  assert.equal(
    (html.match(/class="btn quiet supply-remove/g) || []).length,
    2,
    'both rows reserve the remove slot',
  );
  assert.equal(
    (html.match(/supply-remove is-blank/g) || []).length,
    1,
    'only the blank row hides it',
  );
  // Hidden, but genuinely inert rather than merely invisible.
  assert.match(
    html,
    /supply-remove is-blank" data-supply-remove="1" tabindex="-1" aria-hidden="true"/,
  );
  assert.ok(!html.includes('supply-spacer'), 'no stand-in of a different width');
});

test('a chosen item shows its icon in the field', () => {
  const c = ui();
  guided(c);
  vm.runInContext(
    `wizard.guidedStep=guidedFlow().findIndex(q=>q.id==='supply')+1;wizard.settings.existingSupply={'Modular Frame':50};delete wizard.supplyRows;`,
    c,
  );
  const html = vm.runInContext('renderWizard()', c);
  assert.match(
    html,
    /class="supply-input has-icon" data-icon="Modular Frame"/,
    'the filled row carries its icon',
  );
  assert.match(
    html,
    /supply-input has-icon[^>]*>\s*<img class="item-icon" src="\.\/icons\/modular-frame\.png"/,
    'the icon sits before the input',
  );
  // The blank row has no icon and no reserved indent.
  assert.match(html, /class="supply-input" data-icon=""/);
  assert.equal((html.match(/has-icon/g) || []).length, 1);
  // A name that is not an item gets no icon rather than a broken image.
  vm.runInContext(`wizard.supplyRows=[{name:'Modul',rate:'12'}];`, c);
  const partial = vm.runInContext('renderWizard()', c);
  assert.ok(!partial.includes('has-icon'), 'nothing is shown for a name that is not an item');
  assert.ok(!partial.includes('icons/modul.png'));
  // The icons the suggestion list shows come from the same bundled set.
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

test('the survey renders four screens and links to the map', () => {
  const c = ui();
  guided(c, `wizard.mode='extraction';wizard.extractionStep=1;`);
  const seen = [];
  for (let step = 1; step <= 4; step++) {
    const html = vm.runInContext(`wizard.extractionStep=${step};renderWizard()`, c);
    assert.ok(html.includes('wizard-form'), 'step ' + step);
    assert.ok(html.includes('extraction-panel'), 'step ' + step + ' is the survey');
    seen.push(html);
  }
  // Where the numbers come from, and that uploading a save is the user's call.
  assert.match(seen[0], /satisfactory-calculator\.com\/en\/interactive-map/);
  assert.match(seen[0], /upload your save/i);
  assert.match(seen[0], /never sends your save anywhere/i);
  assert.match(seen[0], /name="mark"/);
  assert.match(seen[0], /name="clock"/);
  // Ten ores, three purities each.
  assert.equal((seen[1].match(/name="node:[^"]+:pure"/g) || []).length, minedResources.length);
  assert.ok(seen[1].includes('icons/iron-ore.png'), 'with the ore icons');
  // Oil nodes and wells are asked separately, and water is explained rather than asked.
  assert.match(seen[2], /name="node:Crude Oil:pure"/);
  assert.match(seen[2], /name="well:Crude Oil:pure"/);
  assert.match(seen[2], /name="well:Nitrogen Gas:pure"/);
  assert.ok(!seen[2].includes('name="node:Water'), 'water is not counted');
  assert.match(seen[2], /Water is not counted/i);
  // The last screen totals it and takes off what is committed.
  assert.match(seen[3], /name="used:Iron Ore"/);
  assert.match(seen[3], /Use these budgets/);
});

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

test('the resource tables show the ore beside its name', () => {
  const c = ui();
  vm.runInContext(
    `calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};`,
    c,
  );
  const calc = vm.runInContext('renderCalculatedResources()', c);
  for (const n of RAW)
    assert.ok(
      calc.includes('icons/' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png'),
      n + ' icon on the calculated page',
    );
  // The original handbook's resources page is a Vue component: tests/ui/pages.test.mjs.
});

test('a node count means a count, and an unsurveyed resource is called out', () => {
  const c = ui();
  guided(c, `wizard.mode='extraction';wizard.extractionStep=2;`);
  const nodes = vm.runInContext('renderWizard()', c);
  // Zero in a node box is "my world has none of that purity" — which is what an
  // all-pure world puts in the first two columns. It is not the "unallocated,
  // not absent" that a zero *budget* means for a resource-rich map.
  assert.ok(
    !nodes.includes('unallocated, not absent'),
    'the budget wording does not belong on a count',
  );
  assert.match(nodes, /Zero means zero/);
  assert.match(nodes, /the plan cannot mine/);
  // Surveying only some resources is flagged before it turns into an
  // unexplainable infeasible plan.
  const partial = blankExtraction();
  partial.nodes = { 'Iron Ore': { impure: 39, normal: 42, pure: 46 } };
  c.partialSurvey = partial;
  vm.runInContext(`wizard.extraction=partialSurvey;wizard.extractionStep=4;`, c);
  const budgets = vm.runInContext('renderWizard()', c);
  assert.match(budgets, /<b>11 resources have no nodes entered:<\/b>/);
  assert.match(budgets, /Copper Ore/);
  assert.ok(!budgets.includes('>Iron Ore</b>'), 'the one that was surveyed is not listed');
  assert.match(budgets, /go back and fill them in/);
  // A complete survey says nothing.
  c.fullSurvey = defaultSurvey();
  vm.runInContext(`wizard.extraction=fullSurvey;`, c);
  assert.ok(!vm.runInContext('renderWizard()', c).includes('no nodes entered'));
  // An all-pure world is a complete survey, zeros and all.
  const allPure = blankExtraction();
  for (const [name, [i, n, p]] of Object.entries(nodeCounts))
    (name === 'Nitrogen Gas' ? allPure.wells : allPure.nodes)[name] = {
      impure: 0,
      normal: 0,
      pure: i + n + p,
    };
  c.pureSurvey = allPure;
  vm.runInContext(`wizard.extraction=pureSurvey;`, c);
  assert.ok(
    !vm.runInContext('renderWizard()', c).includes('no nodes entered'),
    'zero impure and zero normal is an answer, not an omission',
  );
});

test('the survey steps are tabs, and jumping between them keeps what was typed', async () => {
  const c = ui();
  guided(
    c,
    `wizard.mode='extraction';wizard.extractionStep=1;wizard.extractionReturn={mode:'advanced',step:4};`,
  );
  const html = vm.runInContext('renderWizard()', c);
  // The same clickable bar the five-step wizard uses, not a read-only trail.
  assert.equal((html.match(/data-extraction-step="/g) || []).length, 4);
  assert.ok(html.includes('class="wizard-progress"'), 'styled as the wizard tabs');
  assert.ok(!html.includes('guided-progress'), 'and not as the guided dots');
  assert.match(html, /data-extraction-step="1" aria-current="step"/);
  for (const [i, label] of [
    'How you mine',
    'Ore nodes',
    'Resource wells',
    'Your budgets',
  ].entries()) {
    assert.match(
      html,
      new RegExp(String.raw`>\s*${i + 1}\. ${label}\s*</button>`),
      label + ' is a button',
    );
  }
  // Jumping forward and back reads the screen being left, so counts survive.
  c.formStub = { querySelector: () => null, reportValidity: () => true };
  vm.runInContext(
    `FormData=class{constructor(){}get(){return null;}getAll(){return [];}has(){return false;}*[Symbol.iterator](){yield ['node:Iron Ore:pure','46'];}}`,
    c,
  );
  vm.runInContext(
    'render=()=>{};document={querySelector:()=>formStub,querySelectorAll:()=>[],addEventListener(){}};',
    c,
  );
  await vm.runInContext('moveExtraction(4)', c);
  assert.equal(
    vm.runInContext('wizard.extractionStep', c),
    4,
    'jumped straight to the last screen',
  );
  assert.equal(
    vm.runInContext(`wizard.extraction.nodes['Iron Ore'].pure`, c),
    46,
    'and read the screen it left',
  );
  await vm.runInContext('moveExtraction(2)', c);
  assert.equal(vm.runInContext('wizard.extractionStep', c), 2, 'and back again');
  assert.equal(vm.runInContext(`wizard.extraction.nodes['Iron Ore'].pure`, c), 46);
  // A tab never applies the budgets; only the submit button past the last step does.
  assert.ok(
    !vm.runInContext('wizard.settings.extraction', c),
    'no tab click has applied the survey',
  );
  await vm.runInContext('moveExtraction(2)', c);
  assert.equal(
    vm.runInContext('wizard.extractionStep', c),
    2,
    'clicking the current tab is a no-op',
  );
});

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

test('the survey asks the two World Randomization settings and fills what it can', () => {
  const c = ui();
  guided(
    c,
    `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='vanilla';wizard.settings.distribution='original';`,
  );
  const nodes = vm.runInContext('renderWizard()', c);
  // The same pair the game shows, with the same options in the same order.
  assert.match(nodes, /Resource node randomization/);
  assert.match(nodes, /Resource node purity/);
  assert.match(nodes, /name="distribution"/);
  assert.match(nodes, /name="purity"/);
  for (const [, label] of distributions)
    assert.ok(nodes.includes('>' + label + '<'), 'distribution option ' + label);
  for (const [, label] of purities)
    assert.ok(nodes.includes('>' + label + '<'), 'purity option ' + label);
  // Opening the survey with a known world starts from it rather than from blank.
  assert.equal(
    vm.runInContext(`wizard.extraction.nodes['Iron Ore'].normal`, c),
    42,
    'prefilled from the purity already chosen',
  );
  assert.match(nodes, /counts below are the map's node totals at <b>Default<\/b>/);
  // The same bar is on the oil screen, which the same settings also fill.
  assert.ok(vm.runInContext(`wizard.extractionStep=3;renderWizard()`, c).includes('name="purity"'));

  // A purity with no fixed layout starts empty and says why.
  const c2 = ui();
  guided(
    c2,
    `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='random';wizard.settings.distribution='original';`,
  );
  const random = vm.runInContext('renderWizard()', c2);
  assert.match(random, /No preset for these settings/);
  assert.match(random, /no fixed split to rearrange/);
  assert.equal(
    vm.runInContext(`JSON.stringify(wizard.extraction.nodes)`, c2),
    '{}',
    'nothing is invented',
  );

  // Nor does a resource-rich distribution, and that one names the seed.
  const c3 = ui();
  guided(
    c3,
    `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='pure';wizard.settings.distribution='advanced';`,
  );
  const rich = vm.runInContext('renderWizard()', c3);
  assert.match(rich, /No preset for these settings/);
  assert.match(rich, /a third apart from one seed to the next/);
  assert.match(rich, /resource-rich distribution changes how many nodes/);
  assert.equal(vm.runInContext(`JSON.stringify(wizard.extraction.nodes)`, c3), '{}');

  // Counts already on screen under a world we have no table for are flagged as
  // the default world's rather than quietly passed off as the user's.
  vm.runInContext(`wizard.extraction=presetSurvey('pure',wizard.extraction);`, c3);
  assert.match(vm.runInContext('renderWizard()', c3), /still the <b>map's totals at All Pure<\/b>/);
});

test('the survey can be emptied, so a hand counter is never correcting a preset', async () => {
  const c = ui();
  guided(
    c,
    `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='pure';wizard.extraction=presetSurvey('pure',{mark:2,clock:1},'original');wizard.extraction.used={'Iron Ore':500};`,
  );
  assert.equal(
    vm.runInContext(`wizard.extraction.nodes['Iron Ore'].pure`, c),
    127,
    'starts filled',
  );
  // The button is offered on both counting screens, not only the one with ores.
  for (const step of [2, 3]) {
    vm.runInContext('wizard.extractionStep=' + step, c);
    assert.match(vm.runInContext('renderWizard()', c), /data-node-reset/, 'step ' + step);
  }
  // Pressed for real, through the app's own click listener. The first version of
  // this button was gated on confirm(), which a browser may answer false without
  // ever showing a dialog — so the button did nothing and no test noticed. This
  // one asks nothing and is undoable instead, and is exercised by being clicked.
  await clickButton(c, 'data-node-reset');
  const e = vm.runInContext('JSON.stringify(wizard.extraction)', c);
  assert.equal(
    e,
    JSON.stringify({ mark: 2, clock: 1, nodes: {}, wells: {}, used: {} }),
    'emptied but still Mk.2 at 100%',
  );
  // An empty survey is nobody's world, so the screen offers to fill it again.
  assert.equal(matchingPreset(JSON.parse(e)), '', 'no preset claims an empty survey');
  vm.runInContext('wizard.extractionStep=2', c);
  const cleared = vm.runInContext('renderWizard()', c);
  assert.match(cleared, /Fill in the counts below/);
  // Nothing is lost by a misclick: the undo is offered in place of the reset.
  assert.match(cleared, /data-node-undo/, 'undo offered');
  assert.doesNotMatch(cleared, /data-node-reset/, 'and not both at once');
  await clickButton(c, 'data-node-undo');
  assert.equal(vm.runInContext(`wizard.extraction.nodes['Iron Ore'].pure`, c), 127, 'put back');
  assert.equal(
    vm.runInContext(`wizard.extraction.used['Iron Ore']`, c),
    500,
    'including what was committed',
  );
  assert.equal(vm.runInContext('wizard.extractionUndo', c), null, 'and spent');
  assert.match(vm.runInContext('renderWizard()', c), /data-node-reset/, 'reset offered again');

  // Filling from the world settings is the other wholesale change, so it takes
  // the undo with it rather than leaving a button that would undo the fill.
  await clickButton(c, 'data-node-reset');
  await clickButton(c, 'data-node-preset', { nodePreset: 'pure' });
  assert.equal(
    vm.runInContext(`wizard.extraction.nodes['Iron Ore'].pure`, c),
    127,
    'filled from the preset',
  );
  assert.equal(vm.runInContext('wizard.extractionUndo', c), null, 'undo spent by the fill');

  // And leaving the survey does too, so the undo cannot outlive the screen.
  await clickButton(c, 'data-node-reset');
  vm.runInContext('leaveExtraction()', c);
  assert.equal(vm.runInContext('wizard.extractionUndo', c), null, 'undo cleared on the way out');
});

test('a resource-rich world is described, never counted for the user', () => {
  // Direction is the only thing every published count of these worlds agrees
  // on, so it is the only thing the screen says. No numbers, and nothing filled.
  for (const d of ['basic', 'advanced', 'fossil']) {
    assert.ok(richShape[d], d + ' is described');
    assert.ok(!/[0-9]/.test(richShape[d]), d + ' promises no numbers');
    const c = ui();
    guided(
      c,
      `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='pure';wizard.settings.distribution='${d}';`,
    );
    const html = vm.runInContext('renderWizard()', c);
    assert.match(html, /No preset for these settings/, d);
    assert.ok(html.includes(richShape[d].slice(0, 40)), d + ' shape shown');
    assert.match(html, /Which way it goes is consistent; how far is not/, d);
    assert.equal(
      vm.runInContext('JSON.stringify(wizard.extraction.nodes)', c),
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

  // Random with All Pure fills in, and says why it can.
  const c = ui();
  guided(
    c,
    `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='pure';wizard.settings.distribution='randomized';`,
  );
  const html = vm.runInContext('renderWizard()', c);
  assert.equal(
    vm.runInContext(`wizard.extraction.nodes['Iron Ore'].pure`, c),
    127,
    'filled from the shuffle-proof totals',
  );
  assert.match(html, /node totals at <b>All Pure<\/b>/);
  assert.match(html, /Random moves nodes around the map/);
  // The shuffle carries ordinary nodes but not the wells, and says so.
  assert.match(html, /Nitrogen wells are left for you/);
  assert.equal(
    vm.runInContext(`JSON.stringify(wizard.extraction.wells)`, c),
    '{}',
    'nitrogen not filled under Random',
  );

  // Random with the map's own split explains that only the split is missing.
  const c2 = ui();
  guided(
    c2,
    `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='vanilla';wizard.settings.distribution='randomized';`,
  );
  const split = vm.runInContext('renderWizard()', c2);
  assert.match(split, /Only the purity split is missing/);
  assert.match(split, /same number of nodes for each resource as the default map/);
  assert.match(split, /If you actually chose All Pure, Average or All Impure/);
  assert.equal(
    vm.runInContext(`JSON.stringify(wizard.extraction.nodes)`, c2),
    '{}',
    'so nothing is filled in',
  );
});

test('changing a world setting refills the counts, and leaves alone what it cannot know', () => {
  const c = ui();
  guided(
    c,
    `wizard.mode='extraction';wizard.extractionStep=2;wizard.settings.purity='vanilla';wizard.settings.distribution='original';`,
  );
  // An oil well count is the user's own: the known table has none.
  const kept = blankExtraction();
  kept.wells = { 'Crude Oil': { impure: 0, normal: 6, pure: 0 } };
  kept.nodes = { 'Iron Ore': { impure: 39, normal: 42, pure: 46 } };
  c.keptSurvey = kept;
  vm.runInContext(
    `wizard.extraction=keptSurvey;wizard.settings.purity='pure';wizard.extraction=presetSurvey('pure',wizard.extraction);`,
    c,
  );
  assert.equal(
    vm.runInContext(`wizard.extraction.wells['Crude Oil'].normal`, c),
    6,
    'the oil wells the user counted survive',
  );
  assert.equal(
    vm.runInContext(`wizard.extraction.nodes['Iron Ore'].pure`, c),
    127,
    'and the rest is refilled',
  );
  assert.equal(vm.runInContext(`wizard.extraction.nodes['Iron Ore'].impure`, c), 0);
  // Nitrogen is a well, so it is filled there rather than as a node.
  assert.equal(vm.runInContext(`wizard.extraction.nodes['Nitrogen Gas']`, c), undefined);
  assert.equal(vm.runInContext(`wizard.extraction.wells['Nitrogen Gas'].pure`, c), 45);
  // And the bar now reports the world it matches.
  assert.match(vm.runInContext('renderWizard()', c), /node totals at <b>All Pure<\/b>/);
});
