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
  waterExtractors,
  BELT_MARKS,
  PIPE_MARKS,
  EXTRACTOR_OPTIONS,
  isWellKind,
  miningAdvice,
  phaseBelt,
  phaseForTier,
  phaseMiner,
  phaseMining,
} from '../public/preferences.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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
import {
  carryOptions,
  initialState,
  pickedRecipeUnlocks,
  bayCapacity,
  bayOfSlot,
  slotPosition,
} from '../public/state.ts';
import { adaRemarks, adaEncore, adaFault as makeFault } from '../public/ada.ts';
import { calculate, catalog } from '../planner.ts';
import { handbookToPlan } from '../public/handbook-migration.ts';
import { appSource } from './helpers/app-source.ts';
import { handbook, recipes } from './helpers/data.ts';
import type { calcExpansion } from '../public/app/views/calculated.ts';
const source = appSource();
function ui() {
  const node = { addEventListener() {}, close() {}, showModal() {}, innerHTML: '' };
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
    initialState,
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
    // ADA's Water count (#1024), for a plan whose phase extracts Water.
    waterExtractors,
    // The belt and pipe marks (flow.ts) and the mining per phase (mining.ts, #1065).
    BELT_MARKS,
    PIPE_MARKS,
    EXTRACTOR_OPTIONS,
    isWellKind,
    miningAdvice,
    phaseBelt,
    phaseForTier,
    phaseMiner,
    phaseMining,
  });
  vm.runInContext(source, context);
  context.catalogData = catalog();
  context.progressionFixture = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  context.generated = calculate({});
  vm.runInContext(
    `progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World <one>'};currentProfile={id:'original',kind:'calculated',name:'Original'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};`,
    context,
  );
  return context;
}
// The wizard and guided screens themselves: tests/ui/wizard.test.ts.

// Every page is a component; each is rendered with hostile names in tests/ui/.

// The storage page and its container dialog are components, tested in
// tests/ui/storage.test.ts. Their data stays here.
test('an added bay takes the next free letter after the handbook bays', () => {
  const context = ui();
  assert.equal(vm.runInContext('nextBayLetter()', context), 'S');
  vm.runInContext(`state.storageEdits={bays:[{id:'S',name:'Overflow',floor:'ground'}]};`, context);
  assert.equal(vm.runInContext('nextBayLetter()', context), 'T');
});

test('a bay grows past eight containers up to the last addressable position', () => {
  const context = ui();
  vm.runInContext(
    `state.storageEdits={floors:[],floorNames:{},bays:[],bayNames:{},slots:{A10:'Aluminum Casing'},clearedSlots:[]};`,
    context,
  );
  const grown = JSON.parse(
    vm.runInContext(`JSON.stringify(storageBays().find(b=>b.id==='A'))`, context),
  );
  assert.equal(grown.items.length, 10, 'the bay is as long as its highest filled address');
  assert.equal(grown.items[8].name, null, 'the gap up to the added container is reserved');
  assert.equal(grown.items[9].name, 'Aluminum Casing');
  vm.runInContext(
    `state.storageEdits.slots=Object.fromEntries(Array.from({length:bayCapacity-8},(_,i)=>['A'+(i+9),'Item '+i]));`,
    context,
  );
  const bay = vm.runInContext(`storageBays().find(b=>b.id==='A')`, context);
  assert.equal(bay.items.length, bayCapacity);
  assert.equal(bayOfSlot(bay.items.at(-1).id), 'A');
  assert.equal(slotPosition(bay.items.at(-1).id), bayCapacity);
});

test('machine instructions separate total, full-speed and adjustable machines', () => {
  const context = ui();
  context.row = {
    name: 'Rubber',
    machine: 'Refinery',
    machines: 3,
    equivalent: 2.4017,
    lastClock: 40.17,
    outputs: { Rubber: 48.034, 'Heavy Oil Residue': 48.034 },
    inputs: { 'Crude Oil': 72.051 },
  };
  const setup = vm.runInContext('machineSetup(row)', context);
  assert.equal(setup.whole, 2);
  assert.equal(setup.partial, true);
  assert.match(setup.summary, /3 Refinery total: 2 at 100% \+ 1 adjustable/);
  assert.equal(setup.easy.clock, 45);
  assert.equal(setup.easy.output.Rubber, 9);
  context.row = {
    ...context.row,
    equivalent: 3,
    lastClock: 100,
    outputs: { Rubber: 60 },
    inputs: { 'Crude Oil': 90 },
  };
  const full = vm.runInContext('machineSetup(row)', context);
  assert.equal(full.partial, false);
  assert.match(full.summary, /3 at 100%/);
});

// The factories pages, their group editor and the factory dialog are components, tested in
// tests/ui/factories.test.ts; a group's build order is its flow page
// (tests/ui/group-flow-page.test.ts).
test('ADA comments on the plan from the sidebar and can be muted', () => {
  const context = ui();
  // A profile migrated from the handbook (#387): its guide keeps the handbook's steps.
  context.migrated = handbookToPlan(handbook, recipes, catalog().pureLimits).plan;
  vm.runInContext(
    "calculated=migrated;currentProfile={id:'original',kind:'calculated',name:'Original'};",
    context,
  );
  // What the panel shows; its markup is covered by tests/ui/shell.test.ts.
  const ada = () => JSON.parse(vm.runInContext('JSON.stringify(adaView())', context));
  const panel = ada();
  assert.equal(panel.tone, 'calm');
  assert.equal(panel.name, '', 'a normal remark has no fault name');
  assert.match(
    panel.text,
    /Zero of \d+ steps ticked for Phase 3/,
    'the opening line is the most relevant one',
  );
  // A renamed step is the user's own text wherever ADA repeats it (the component escapes it).
  vm.runInContext(
    "state.taskEdits={titles:{[planTasks()[0].id]:'Weld the <boat>'}};adaSignature='';",
    context,
  );
  assert.match(ada().text, /Weld the <boat>/);
  // Cycling walks the whole list and wraps round to the first line.
  const seen = [...Array(8)].map((_, i) =>
    vm.runInContext('adaIndex=' + i + ';adaCurrent().text', context),
  );
  assert.ok(new Set(seen).size >= 7, 'ADA has more than one thing to say');
  assert.equal(vm.runInContext('adaIndex=0;adaCurrent().text', context), seen[0]);
  // The plan decides the tone: a draft profile leads with the draft.
  vm.runInContext(
    "calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};calculated.stages['3'].feasible=false;calculated.stages['3'].reason='Iron Ore budget exceeded.';adaSignature='';",
    context,
  );
  const draft = ada();
  assert.equal(draft.tone, 'warn');
  assert.match(
    draft.text,
    /planning draft, not a plan[^]*Iron Ore budget exceeded\./,
    'ADA repeats the planner’s own reason',
  );
  // Back to the migrated profile, whose remarks were seen above.
  vm.runInContext(
    "delete calculated.stages['3'].feasible;delete calculated.stages['3'].reason;calculated=migrated;currentProfile={id:'original',kind:'calculated',name:'Original'};state.taskEdits=undefined;adaSignature='';",
    context,
  );
  // A delivery is open until its saved count reaches the target, and one with no saved count has
  // none yet, as ui/plan/DeliveryCounter.vue reads it. (The migration saved the handbook's starting
  // counts, migrateHandbookState, so a migrated profile reads them like any saved count.)
  const openDeliveries = () =>
    JSON.parse(vm.runInContext('JSON.stringify(adaFacts().deliveries)', context));
  const total = vm.runInContext('Object.keys(calcStage().delivery).length', context);
  assert.ok(total >= 2, 'the migrated Phase 3 has deliveries');
  assert.deepEqual(openDeliveries(), { open: total, total }, 'nothing saved: every one is open');
  vm.runInContext(
    "const [handedIn, delivery] = Object.entries(calcStage().delivery)[0];state.deliveries={[stage()+'-'+slug(handedIn)]: delivery.target};",
    context,
  );
  assert.deepEqual(openDeliveries(), { open: total - 1, total }, 'a saved count that reaches it');
  vm.runInContext('state.deliveries={};', context);
  // Cycling past the last remark is answered rather than silently repeated.
  const count = vm.runInContext('adaCurrent();adaRemarks(adaFacts()).length', context);
  assert.match(
    vm.runInContext('adaIndex=' + count + ';adaCurrent().text', context),
    /everything I hold on this save/,
  );
  assert.match(vm.runInContext('adaIndex=' + count * 2 + ';adaCurrent().text', context), /twice/);
  assert.equal(
    vm.runInContext('adaIndex=' + (count + 1) + ';adaCurrent().text', context),
    seen[1],
    'the lap resumes where it left off',
  );
  // Prod the badge five times and the corporate voice slips. Pokes only count within 2.5 s of
  // each other, so the page's clock stands still here (#221): a stall on a busy machine would
  // otherwise start the count over.
  vm.runInContext('pokeClock=1e12;Date.now=()=>pokeClock;', context);
  vm.runInContext('adaIndex=0;for(let i=0;i<3;i++)adaPoke();pokeClock+=2501;adaPoke();', context);
  assert.notEqual(ada().name, '???', 'a gap over 2.5 s starts the count over');
  vm.runInContext('for(let i=0;i<3;i++)adaPoke();', context);
  assert.notEqual(ada().name, '???', 'four prods are within tolerance');
  vm.runInContext('adaPoke()', context);
  const fault = ada();
  assert.equal(fault.tone, 'fault');
  assert.equal(fault.name, '???');
  vm.runInContext('adaPoke()', context);
  assert.notEqual(
    vm.runInContext('adaCurrent().text', context),
    vm.runInContext('makeFault(1).text', context),
    'prodding again advances the transmission',
  );
  assert.equal(ada().tone, 'fault');
  // Anything else hands the terminal back, and no timer is left running.
  vm.runInContext('adaClearFault();', context);
  assert.equal(ada().name, '');
  // Muted: no remark.
  vm.runInContext('adaMuted=true;', context);
  assert.deepEqual(ada(), { muted: true });
  vm.runInContext("adaMuted=false;adaIndex=0;adaSignature='';adaClearFault();", context);
});

test('storage follows the selected contract and small power displays in MW', () => {
  const context = ui();
  vm.runInContext(
    `calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Stock'};`,
    context,
  );
  const named = () =>
    JSON.parse(
      vm.runInContext(
        `JSON.stringify(storageBays().flatMap(b=>b.items).filter(x=>x.name).map(x=>x.name))`,
        context,
      ),
    );
  assert.ok(named().includes('Iron Plate'));
  vm.runInContext(
    `calculated=structuredClone(generated);for(const stage of Object.values(calculated.stages))stage.storage={};calculated.settings.storage='none';calculated.settings.collectables=false;`,
    context,
  );
  assert.deepEqual(named(), [], 'nothing selected leaves no containers');
  assert.equal(vm.runInContext('power(500)', context), '500 MW');
  assert.equal(vm.runInContext('power(1000)', context), (1000).toLocaleString() + ' MW');
  assert.equal(vm.runInContext('power(1500)', context), (1.5).toLocaleString() + ' GW');
});
test('wizard tabs retain edits and recalculate Review', async () => {
  const context = ui();
  vm.runInContext(
    `wizard={step:1,saveName:'World',name:'',settings:structuredClone(generated.settings),preview:generated};render=()=>{};`,
    context,
  );
  const form = {
    reportValidity: () => true,
    querySelector: (selector: string) =>
      ['.alt-list', '.carry-list'].includes(selector) ? null : { textContent: '' },
  };
  context.document.querySelector = () => form;
  context.FormData = class {
    *[Symbol.iterator]() {
      yield ['saveName', 'Edited world'];
      yield ['purity', 'pure'];
    }
    has() {
      return false;
    }
    getAll() {
      return [];
    }
  };
  await vm.runInContext('moveWizard(2)', context);
  assert.equal(vm.runInContext('wizard.saveName', context), 'Edited world');
  assert.equal(vm.runInContext('wizard.settings.limits["Iron Ore"]', context), 152400);
  assert.equal(vm.runInContext('wizard.preview', context), null);
  context.FormData = class {
    *[Symbol.iterator]() {
      yield ['utilityPercent', '35'];
      yield ['installedPowerMW', '60000'];
      yield ['somersloops', '104'];
      yield ['augmenters', '1'];
      yield ['fueledAugmenters', '1'];
    }
    has() {
      return false;
    }
    getAll() {
      return ['shards'];
    }
  };
  vm.runInContext(
    `post=async(url,body)=>{if(body.settings.utilityPercent!==35)throw Error('Lost input');if(body.settings.augmenters!==1||body.settings.fueledAugmenters!==1||body.settings.somersloops!==104)throw Error('Lost the somersloop ledger');if(body.settings.installedPowerGW!==60)throw Error('Lost installed power');if(String(body.settings.sloopReserved)!=='shards')throw Error('Lost the reserved lines');return generated;}`,
    context,
  );
  await vm.runInContext('moveWizard(5)', context);
  assert.equal(vm.runInContext('wizard.step', context), 5);
});

test('the wizard shows calculation progress and options when the calculation times out', async () => {
  const context = ui();
  vm.runInContext(
    `wizard={step:4,saveName:'W',name:'P',settings:structuredClone(generated.settings),preview:null};render=()=>{};`,
    context,
  );
  // The error line takes focus once set (SP-34).
  const errorNode = {
    textContent: '',
    innerHTML: '',
    focused: false,
    focus() {
      this.focused = true;
    },
  };
  const submitNode = { textContent: 'Calculate plan' };
  const form = {
    reportValidity: () => true,
    querySelector: (selector: string) =>
      ['.alt-list', '.carry-list'].includes(selector)
        ? null
        : selector === 'button[type="submit"]'
          ? submitNode
          : errorNode,
  };
  context.document.querySelector = () => form;
  context.FormData = class {
    *[Symbol.iterator]() {}
    has() {
      return false;
    }
    getAll() {
      return [];
    }
  };
  context.buttonText = () => submitNode.textContent;
  vm.runInContext(
    `let progressText='';post=async(url,body,scope,extra)=>{extra.onProgress(3);progressText=buttonText();throw Error('Calculation timed out. Try fewer alternate recipes or a smaller goal.');};`,
    context,
  );
  await vm.runInContext('moveWizard(5)', context);
  assert.equal(
    vm.runInContext('progressText', context),
    'Calculating… Phase 3 of 5…',
    'the submit button reports the phase being calculated',
  );
  assert.equal(
    submitNode.textContent,
    'Calculate plan',
    'the button label is restored after a failure',
  );
  assert.match(errorNode.innerHTML, /timed out/, 'the timeout message is shown');
  assert.equal(errorNode.focused, true, 'and takes focus');
  assert.match(
    errorNode.innerHTML,
    /Planner’s choice/,
    'the guidance suggests reducing picks with Planner’s choice',
  );
  assert.match(
    errorNode.innerHTML,
    /whole-machine production/,
    'the guidance mentions the whole-machine setting',
  );
  vm.runInContext(`post=async()=>{throw Error('Save not found.');}`, context);
  errorNode.innerHTML = '';
  errorNode.textContent = '';
  await vm.runInContext('moveWizard(5)', context);
  assert.equal(errorNode.textContent, 'Save not found.', 'other errors stay plain text');
  assert.equal(errorNode.innerHTML, '', 'no guidance is attached to unrelated errors');
});

// The alternate picker itself: tests/ui/wizard.test.ts.
test('Planner’s choice collects the alternates a plan uses', () => {
  const context = ui();
  assert.equal(
    vm.runInContext('JSON.stringify(alternatesUsed(generated))', context),
    '["Recipe_Alternate_EnrichedCoal_C","Recipe_Alternate_Turbofuel_C"]',
    'a standard plan uses no hard-drive alternates, but its turbofuel power chain still needs the MAM picks',
  );
  assert.equal(
    vm.runInContext(
      `JSON.stringify(alternatesUsed({stages:{a:{rows:[{id:'x',alternate:true},{id:'y'}]},b:{rows:[{id:'x',alternate:true}]}}}))`,
      context,
    ),
    '["x"]',
    'used alternates are collected uniquely across phases',
  );
  assert.equal(
    vm.runInContext(
      `JSON.stringify(alternatesUsed({stages:{a:{rows:[{id:'Recipe_Alternate_Turbofuel_C',alternate:false},{id:'y'}]}}}))`,
      context,
    ),
    '["Recipe_Alternate_Turbofuel_C"]',
    'MAM recipes count as used alternates even though plans mark them standard',
  );
  // An amplified twin and a group's own line pick their recipe, which the planner accepts (#901).
  assert.equal(
    vm.runInContext(
      `JSON.stringify(alternatesUsed({stages:{a:{rows:[{id:'amp:x',alternate:true},{id:'amp:Recipe_Alternate_Turbofuel_C',alternate:false},{id:'z:fg-alpha1',alternate:true,onSite:{group:'fg-alpha1',recipe:'z'}}]}}}))`,
      context,
    ),
    '["Recipe_Alternate_Turbofuel_C","x","z"]',
    'amplified and on-site lines count as their recipe',
  );
});

// The carry panel itself: tests/ui/wizard.test.ts.
test('the carry-over choices are read into the draft', () => {
  const context = ui();
  vm.runInContext(
    `wizard={step:5,saveId:'s1',saveName:'One world',name:'Third',settings:structuredClone(generated.settings),preview:generated,carryFrom:'p2',carry:Object.fromEntries(carryOptions.map(([k])=>[k,true]))};`,
    context,
  );
  context.FormData = class {
    getAll() {
      return ['storage', 'factories'];
    }
    get() {
      return 'p1';
    }
  };
  vm.runInContext(`readCarry({querySelector:sel=>sel==='.carry-list'?{}:null})`, context);
  assert.equal(
    vm.runInContext('wizard.carryFrom', context),
    'p1',
    'the chosen source profile is kept',
  );
  assert.equal(vm.runInContext('wizard.carry.storage', context), true, 'ticked options are kept');
  assert.equal(
    vm.runInContext('wizard.carry.notes', context),
    false,
    'unticked options are cleared',
  );
  // Without the panel on screen (a brand new save) the draft is left alone.
  vm.runInContext(`readCarry({querySelector:()=>null})`, context);
  assert.equal(vm.runInContext('wizard.carryFrom', context), 'p1');
});

// The storage rate fields themselves: tests/ui/wizard.test.ts.
test('per-item storage rates are read back, keeping zero and leaving blanks unset', () => {
  const context = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'World',name:'Balanced',settings:structuredClone(generated.settings),preview:null};wizard.settings.storage='all';wizard.settings.storageOverrides={};`,
    context,
  );
  const form = {
    querySelector: (selector: string) => (selector === '.rate-list' ? {} : null),
    reportValidity: () => true,
  };
  context.FormData = class {
    *[Symbol.iterator]() {
      yield ['rate:Concrete', '60'];
      yield ['rate:Screws', '0'];
      yield ['rate:Wire', ''];
    }
    has() {
      return false;
    }
    getAll() {
      return [];
    }
    get() {
      return null;
    }
  };
  vm.runInContext('readWizard(form)', Object.assign(context, { form }));
  assert.equal(
    vm.runInContext('JSON.stringify(wizard.settings.storageOverrides)', context),
    '{"Concrete":60,"Screws":0}',
    'blank boxes stay unset while zero is kept',
  );
});

// The goals step and Review themselves: tests/ui/wizard.test.ts.
test('the target-time choice is read out of the goals step', () => {
  const context = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'World',name:'Balanced',settings:structuredClone(generated.settings),preview:null};wizard.step=3;wizard.settings.goal='timed';`,
    context,
  );
  const form = { querySelector: () => null, reportValidity: () => true };
  context.FormData = class {
    *[Symbol.iterator]() {
      yield ['phaseTime', 'final'];
      yield ['goal', 'timed'];
    }
    has() {
      return false;
    }
    getAll() {
      return [];
    }
    get() {
      return null;
    }
  };
  vm.runInContext('readWizard(form)', Object.assign(context, { form }));
  assert.equal(
    vm.runInContext('wizard.settings.phaseTime', context),
    'final',
    'the choice is carried out of the form',
  );
});

test('the expansion table only claims an addition where there is one', () => {
  const context = ui();
  vm.runInContext(
    `calculated={stages:{1:{rows:[]},2:{rows:[{id:'iron',machines:4}]},3:{rows:[{id:'iron',machines:4}]},4:{rows:[{id:'iron',machines:9}]},5:{rows:[]}}};`,
    context,
  );
  const rows: ReturnType<typeof calcExpansion> = JSON.parse(
    vm.runInContext(`JSON.stringify(calcExpansion('iron'))`, context),
  );
  assert.equal(rows.length, 5, 'every phase is listed');
  const cells = rows.map(r => [r.required, r.add]);
  assert.deepEqual(cells[0], ['—', '—'], 'a phase without the line has nothing to show or add');
  assert.deepEqual(cells[1], [4, '+4'], 'the phase that first builds it adds four');
  assert.deepEqual(cells[2], [4, '—'], 'an unchanged phase adds nothing');
  assert.deepEqual(cells[3], [9, '+5'], 'growth shows only the extra machines');
  assert.deepEqual(cells[4], ['—', '—'], 'a phase that drops the line adds nothing');
});

test('a profile plans production from the phase it was created for', () => {
  const context = ui();
  vm.runInContext(
    `calculated={...generated,settings:{...generated.settings,phase:'3'}};currentProfile={id:'p',kind:'calculated',name:'Balanced'};`,
    context,
  );
  // The phases before the start phase are offered milestone-only (#759).
  assert.equal(
    vm.runInContext('JSON.stringify(phaseOptions())', context),
    '["1","2","3","4","5","post"]',
    'a phase 3 profile offers the phases behind it for their milestones',
  );
  assert.equal(
    vm.runInContext(`state.settings.phase='1';phase()`, context),
    '1',
    'a stored phase behind the start is that milestone-only phase',
  );
  assert.equal(vm.runInContext(`milestoneOnly()`, context), true);
  assert.equal(vm.runInContext(`calcStage()`, context), undefined, 'with no stage to build');
  assert.equal(vm.runInContext(`state.settings.phase='3';milestoneOnly()`, context), false);
  // A plan guide (a profile moved from the handbook) has its own steps and no such phases.
  vm.runInContext(`calculated={...calculated,guide:{phases:{}}};`, context);
  assert.equal(
    vm.runInContext('JSON.stringify(phaseOptions())', context),
    '["3","4","5","post"]',
    'a guided phase 3 profile starts at phase 3',
  );
  assert.equal(
    vm.runInContext(`state.settings.phase='1';phase()`, context),
    '3',
    'and reads a stored phase behind it as the start',
  );
  vm.runInContext(`calculated={...generated,settings:{...generated.settings,phase:'3'}};`, context);
  assert.equal(
    vm.runInContext(`state.settings.phase='4';phase()`, context),
    '4',
    'a later phase is left alone',
  );
  assert.equal(
    vm.runInContext(`state.settings.phase='post';phase()`, context),
    'post',
    'post-game is still reachable',
  );

  vm.runInContext(
    `calculated={...generated,settings:{...generated.settings,phase:'1'}};state.settings.phase='1';`,
    context,
  );
  // Review flags only the phases the profile plans: tests/ui/wizard.test.ts.

  assert.equal(
    vm.runInContext('JSON.stringify(phaseOptions())', context),
    '["1","2","3","4","5","post"]',
    'a phase 1 profile offers everything',
  );

  // With no plan open (the empty workspace's placeholder) the start is Phase 1.
  vm.runInContext(`calculated=null;state.settings.phase='3';`, context);
  assert.equal(vm.runInContext('startPhase()', context), '1');

  // the expansion table follows the same bound
  vm.runInContext(
    `calculated={settings:{phase:'3'},stages:{1:{rows:[{id:'iron',machines:9}]},2:{rows:[{id:'iron',machines:9}]},3:{rows:[{id:'iron',machines:4}]},4:{rows:[{id:'iron',machines:6}]},5:{rows:[]}}};`,
    context,
  );
  const rows: ReturnType<typeof calcExpansion> = JSON.parse(
    vm.runInContext(`JSON.stringify(calcExpansion('iron'))`, context),
  );
  assert.equal(rows.length, 3, 'only the phases this profile builds are listed');
  assert.deepEqual(
    rows[0],
    {
      phase: '3',
      label: 'Phase 3',
      current: true,
      tag: 'current',
      required: 4,
      add: '+4',
      running: false,
    },
    'the starting phase builds its own machines from scratch',
  );
  // Each row is labelled; only the phase worked on is current (SP-22).
  assert.deepEqual(
    rows.map(r => [r.label, r.current]),
    [
      ['Phase 3', true],
      ['Phase 4', false],
      ['Phase 5', false],
    ],
  );
});
