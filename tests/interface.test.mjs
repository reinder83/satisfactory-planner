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
} from '../public/preferences.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { progression } from '../public/progression.js';
import {
  carryOptions,
  initialState,
  pickedRecipeUnlocks,
  bayCapacity,
  bayOfSlot,
  slotPosition,
} from '../public/state.js';
import { adaRemarks, adaEncore, adaFault as makeFault } from '../public/ada.js';
import { calculate, catalog } from '../planner.mjs';
import { appSource } from './helpers/app-source.mjs';
const source = appSource();
function ui() {
  const node = { addEventListener() {}, close() {}, showModal() {}, innerHTML: '' };
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
    adaRemarks,
    adaEncore,
    makeFault,
    progression,
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
  });
  vm.runInContext(source, c);
  c.fixture = JSON.parse(fs.readFileSync(new URL('../public/plan.json', import.meta.url), 'utf8'));
  c.catalogData = catalog();
  c.progressionFixture = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  c.generated = calculate({});
  vm.runInContext(
    `plan=fixture;progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World <one>'};currentProfile={id:'original',kind:'original',name:'Original'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};`,
    c,
  );
  return c;
}
// The wizard and guided screens themselves: tests/ui/wizard.test.mjs.

// Every page is a component; each is rendered with hostile names in tests/ui/.

// The storage page and its container dialog are components, tested in
// tests/ui/storage.test.mjs. Their data stays here.
test('an added bay takes the next free letter after the handbook bays', () => {
  const c = ui();
  assert.equal(vm.runInContext('nextBayLetter()', c), 'S');
  vm.runInContext(`state.storageEdits={bays:[{id:'S',name:'Overflow',floor:'ground'}]};`, c);
  assert.equal(vm.runInContext('nextBayLetter()', c), 'T');
});

test('a bay grows past eight containers up to the last addressable position', () => {
  const c = ui();
  vm.runInContext(
    `state.storageEdits={floors:[],floorNames:{},bays:[],bayNames:{},slots:{A10:'Aluminum Casing'},clearedSlots:[]};`,
    c,
  );
  const grown = JSON.parse(vm.runInContext(`JSON.stringify(storageBays().find(b=>b.id==='A'))`, c));
  assert.equal(grown.items.length, 10, 'the bay is as long as its highest filled address');
  assert.equal(grown.items[8].name, null, 'the gap up to the added container is reserved');
  assert.equal(grown.items[9].name, 'Aluminum Casing');
  vm.runInContext(
    `state.storageEdits.slots=Object.fromEntries(Array.from({length:bayCapacity-8},(_,i)=>['A'+(i+9),'Item '+i]));`,
    c,
  );
  const bay = vm.runInContext(`storageBays().find(b=>b.id==='A')`, c);
  assert.equal(bay.items.length, bayCapacity);
  assert.equal(bayOfSlot(bay.items.at(-1).id), 'A');
  assert.equal(slotPosition(bay.items.at(-1).id), bayCapacity);
});

test('machine instructions separate total, full-speed and adjustable machines', () => {
  const c = ui();
  c.row = {
    name: 'Rubber',
    machine: 'Refinery',
    machines: 3,
    equivalent: 2.4017,
    lastClock: 40.17,
    outputs: { Rubber: 48.034, 'Heavy Oil Residue': 48.034 },
    inputs: { 'Crude Oil': 72.051 },
  };
  const setup = vm.runInContext('machineSetup(row)', c);
  assert.equal(setup.whole, 2);
  assert.equal(setup.partial, true);
  assert.match(setup.summary, /3 Refinery total: 2 at 100% \+ 1 adjustable/);
  assert.equal(setup.easy.clock, 45);
  assert.equal(setup.easy.output.Rubber, 9);
  c.row = {
    ...c.row,
    equivalent: 3,
    lastClock: 100,
    outputs: { Rubber: 60 },
    inputs: { 'Crude Oil': 90 },
  };
  const full = vm.runInContext('machineSetup(row)', c);
  assert.equal(full.partial, false);
  assert.match(full.summary, /3 at 100%/);
});

// The factories pages, their group editor and the factory and group build-order dialogs are
// components, tested in tests/ui/factories.test.mjs.
test('ADA comments on the plan from the sidebar and can be muted', () => {
  const c = ui();
  // What the panel shows; its markup is covered by tests/ui/shell.test.mjs.
  const ada = () => JSON.parse(vm.runInContext('JSON.stringify(adaView())', c));
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
    c,
  );
  assert.match(ada().text, /Weld the <boat>/);
  // Cycling walks the whole list and wraps round to the first line.
  const seen = [...Array(8)].map((_, i) =>
    vm.runInContext('adaIndex=' + i + ';adaCurrent().text', c),
  );
  assert.ok(new Set(seen).size >= 7, 'ADA has more than one thing to say');
  assert.equal(vm.runInContext('adaIndex=0;adaCurrent().text', c), seen[0]);
  // The plan decides the tone: a draft profile leads with the draft.
  vm.runInContext(
    "calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};calculated.stages['3'].feasible=false;calculated.stages['3'].reason='Iron Ore budget exceeded.';adaSignature='';",
    c,
  );
  const draft = ada();
  assert.equal(draft.tone, 'warn');
  assert.match(
    draft.text,
    /planning draft, not a plan[^]*Iron Ore budget exceeded\./,
    'ADA repeats the planner’s own reason',
  );
  vm.runInContext(
    "delete calculated.stages['3'].feasible;delete calculated.stages['3'].reason;calculated=null;currentProfile={id:'original',kind:'original',name:'Original'};state.taskEdits=undefined;adaSignature='';",
    c,
  );
  // Cycling past the last remark is answered rather than silently repeated.
  const count = vm.runInContext('adaCurrent();adaRemarks(adaFacts()).length', c);
  assert.match(
    vm.runInContext('adaIndex=' + count + ';adaCurrent().text', c),
    /everything I hold on this save/,
  );
  assert.match(vm.runInContext('adaIndex=' + count * 2 + ';adaCurrent().text', c), /twice/);
  assert.equal(
    vm.runInContext('adaIndex=' + (count + 1) + ';adaCurrent().text', c),
    seen[1],
    'the lap resumes where it left off',
  );
  // Prod the badge five times and the corporate voice slips.
  vm.runInContext('adaIndex=0;for(let i=0;i<4;i++)adaPoke();', c);
  assert.notEqual(ada().name, '???', 'four prods are within tolerance');
  vm.runInContext('adaPoke()', c);
  const fault = ada();
  assert.equal(fault.tone, 'fault');
  assert.equal(fault.name, '???');
  vm.runInContext('adaPoke()', c);
  assert.notEqual(
    vm.runInContext('adaCurrent().text', c),
    vm.runInContext('makeFault(1).text', c),
    'prodding again advances the transmission',
  );
  assert.equal(ada().tone, 'fault');
  // Anything else hands the terminal back, and no timer is left running.
  vm.runInContext('adaClearFault();', c);
  assert.equal(ada().name, '');
  // Muted: no remark.
  vm.runInContext('adaMuted=true;', c);
  assert.deepEqual(ada(), { muted: true });
  vm.runInContext("adaMuted=false;adaIndex=0;adaSignature='';adaClearFault();", c);
});

test('storage follows the selected contract and small power displays in MW', () => {
  const c = ui();
  vm.runInContext(
    `calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Stock'};`,
    c,
  );
  const named = () =>
    JSON.parse(
      vm.runInContext(
        `JSON.stringify(storageBays().flatMap(b=>b.items).filter(x=>x.name).map(x=>x.name))`,
        c,
      ),
    );
  assert.ok(named().includes('Iron Plate'));
  vm.runInContext(
    `calculated=structuredClone(generated);for(const stage of Object.values(calculated.stages))stage.storage={};calculated.settings.storage='none';calculated.settings.collectables=false;`,
    c,
  );
  assert.deepEqual(named(), [], 'nothing selected leaves no containers');
  assert.equal(vm.runInContext('power(500)', c), '500 MW');
  assert.equal(vm.runInContext('power(1000)', c), (1000).toLocaleString() + ' MW');
  assert.equal(vm.runInContext('power(1500)', c), (1.5).toLocaleString() + ' GW');
});
test('wizard tabs retain edits and recalculate Review', async () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:1,saveName:'World',name:'',settings:structuredClone(generated.settings),preview:generated};render=()=>{};`,
    c,
  );
  const form = {
    reportValidity: () => true,
    querySelector: sel => (['.alt-list', '.carry-list'].includes(sel) ? null : { textContent: '' }),
  };
  c.document.querySelector = () => form;
  c.FormData = class {
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
  await vm.runInContext('moveWizard(2)', c);
  assert.equal(vm.runInContext('wizard.saveName', c), 'Edited world');
  assert.equal(vm.runInContext('wizard.settings.limits["Iron Ore"]', c), 152400);
  assert.equal(vm.runInContext('wizard.preview', c), null);
  c.FormData = class {
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
    c,
  );
  await vm.runInContext('moveWizard(5)', c);
  assert.equal(vm.runInContext('wizard.step', c), 5);
});

test('the wizard shows calculation progress and options when the calculation times out', async () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:4,saveName:'W',name:'P',settings:structuredClone(generated.settings),preview:null};render=()=>{};`,
    c,
  );
  const errorNode = { textContent: '', innerHTML: '' };
  const submitNode = { textContent: 'Calculate plan' };
  const form = {
    reportValidity: () => true,
    querySelector: sel =>
      ['.alt-list', '.carry-list'].includes(sel)
        ? null
        : sel === 'button[type="submit"]'
          ? submitNode
          : errorNode,
  };
  c.document.querySelector = () => form;
  c.FormData = class {
    *[Symbol.iterator]() {}
    has() {
      return false;
    }
    getAll() {
      return [];
    }
  };
  c.buttonText = () => submitNode.textContent;
  vm.runInContext(
    `let progressText='';post=async(url,body,scope,extra)=>{extra.onProgress(3);progressText=buttonText();throw Error('Calculation timed out. Try fewer alternate recipes or a smaller goal.');};`,
    c,
  );
  await vm.runInContext('moveWizard(5)', c);
  assert.equal(
    vm.runInContext('progressText', c),
    'Calculating… Phase 3 of 5…',
    'the submit button reports the phase being calculated',
  );
  assert.equal(
    submitNode.textContent,
    'Calculate plan',
    'the button label is restored after a failure',
  );
  assert.match(errorNode.innerHTML, /timed out/, 'the timeout message is shown');
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
  vm.runInContext(`post=async()=>{throw Error('Save not found.');}`, c);
  errorNode.innerHTML = '';
  errorNode.textContent = '';
  await vm.runInContext('moveWizard(5)', c);
  assert.equal(errorNode.textContent, 'Save not found.', 'other errors stay plain text');
  assert.equal(errorNode.innerHTML, '', 'no guidance is attached to unrelated errors');
});

// The alternate picker itself: tests/ui/wizard.test.mjs.
test('Planner’s choice collects the alternates a plan uses', () => {
  const c = ui();
  assert.equal(
    vm.runInContext('JSON.stringify(alternatesUsed(generated))', c),
    '["Recipe_Alternate_EnrichedCoal_C","Recipe_Alternate_Turbofuel_C"]',
    'a standard plan uses no hard-drive alternates, but its turbofuel power chain still needs the MAM picks',
  );
  assert.equal(
    vm.runInContext(
      `JSON.stringify(alternatesUsed({stages:{a:{rows:[{id:'x',alternate:true},{id:'y'}]},b:{rows:[{id:'x',alternate:true}]}}}))`,
      c,
    ),
    '["x"]',
    'used alternates are collected uniquely across phases',
  );
  assert.equal(
    vm.runInContext(
      `JSON.stringify(alternatesUsed({stages:{a:{rows:[{id:'Recipe_Alternate_Turbofuel_C',alternate:false},{id:'y'}]}}}))`,
      c,
    ),
    '["Recipe_Alternate_Turbofuel_C"]',
    'MAM recipes count as used alternates even though plans mark them standard',
  );
});

// The carry panel itself: tests/ui/wizard.test.mjs.
test('the carry-over choices are read into the draft', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:5,saveId:'s1',saveName:'One world',name:'Third',settings:structuredClone(generated.settings),preview:generated,carryFrom:'p2',carry:Object.fromEntries(carryOptions.map(([k])=>[k,true]))};`,
    c,
  );
  c.FormData = class {
    getAll() {
      return ['storage', 'factories'];
    }
    get() {
      return 'p1';
    }
  };
  vm.runInContext(`readCarry({querySelector:sel=>sel==='.carry-list'?{}:null})`, c);
  assert.equal(vm.runInContext('wizard.carryFrom', c), 'p1', 'the chosen source profile is kept');
  assert.equal(vm.runInContext('wizard.carry.storage', c), true, 'ticked options are kept');
  assert.equal(vm.runInContext('wizard.carry.notes', c), false, 'unticked options are cleared');
  // Without the panel on screen (a brand new save) the draft is left alone.
  vm.runInContext(`readCarry({querySelector:()=>null})`, c);
  assert.equal(vm.runInContext('wizard.carryFrom', c), 'p1');
});

// The storage rate fields themselves: tests/ui/wizard.test.mjs.
test('per-item storage rates are read back, keeping zero and leaving blanks unset', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'World',name:'Balanced',settings:structuredClone(generated.settings),preview:null};wizard.settings.storage='all';wizard.settings.storageOverrides={};`,
    c,
  );
  const form = {
    querySelector: sel => (sel === '.rate-list' ? {} : null),
    reportValidity: () => true,
  };
  c.FormData = class {
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
  vm.runInContext('readWizard(form)', Object.assign(c, { form }));
  assert.equal(
    vm.runInContext('JSON.stringify(wizard.settings.storageOverrides)', c),
    '{"Concrete":60,"Screws":0}',
    'blank boxes stay unset while zero is kept',
  );
});

// The goals step and Review themselves: tests/ui/wizard.test.mjs.
test('the target-time choice is read out of the goals step', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'World',name:'Balanced',settings:structuredClone(generated.settings),preview:null};wizard.step=3;wizard.settings.goal='timed';`,
    c,
  );
  const form = { querySelector: () => null, reportValidity: () => true };
  c.FormData = class {
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
  vm.runInContext('readWizard(form)', Object.assign(c, { form }));
  assert.equal(
    vm.runInContext('wizard.settings.phaseTime', c),
    'final',
    'the choice is carried out of the form',
  );
});

test('the expansion table only claims an addition where there is one', () => {
  const c = ui();
  vm.runInContext(
    `calculated={stages:{1:{rows:[]},2:{rows:[{id:'iron',machines:4}]},3:{rows:[{id:'iron',machines:4}]},4:{rows:[{id:'iron',machines:9}]},5:{rows:[]}}};`,
    c,
  );
  const rows = JSON.parse(vm.runInContext(`JSON.stringify(calcExpansion('iron'))`, c));
  assert.equal(rows.length, 5, 'every phase is listed');
  const cells = rows.map(r => [r.required, r.add]);
  assert.deepEqual(cells[0], ['—', '—'], 'a phase without the line has nothing to show or add');
  assert.deepEqual(cells[1], [4, '+4'], 'the phase that first builds it adds four');
  assert.deepEqual(cells[2], [4, '—'], 'an unchanged phase adds nothing');
  assert.deepEqual(cells[3], [9, '+5'], 'growth shows only the extra machines');
  assert.deepEqual(cells[4], ['—', '—'], 'a phase that drops the line adds nothing');
});

test('a profile only offers the phases it was created for', () => {
  const c = ui();
  vm.runInContext(
    `calculated={...generated,settings:{...generated.settings,phase:'3'}};currentProfile={id:'p',kind:'calculated',name:'Balanced'};`,
    c,
  );
  assert.equal(
    vm.runInContext('JSON.stringify(phaseOptions())', c),
    '["3","4","5","post"]',
    'a phase 3 profile hides the phases behind it',
  );
  assert.equal(
    vm.runInContext(`state.settings.phase='1';phase()`, c),
    '3',
    'a stored phase behind the start reads as the start',
  );
  assert.equal(
    vm.runInContext(`state.settings.phase='4';phase()`, c),
    '4',
    'a later phase is left alone',
  );
  assert.equal(
    vm.runInContext(`state.settings.phase='post';phase()`, c),
    'post',
    'post-game is still reachable',
  );

  vm.runInContext(
    `calculated={...generated,settings:{...generated.settings,phase:'1'}};state.settings.phase='1';`,
    c,
  );
  // Review flags only the phases the profile plans: tests/ui/wizard.test.mjs.

  assert.equal(
    vm.runInContext('JSON.stringify(phaseOptions())', c),
    '["1","2","3","4","5","post"]',
    'a phase 1 profile offers everything',
  );

  vm.runInContext(
    `calculated=null;currentProfile={id:'original',kind:'original',name:'Original'};state.settings.phase='3';`,
    c,
  );
  assert.equal(
    vm.runInContext('JSON.stringify(phaseOptions())', c),
    '["3","4","5","post"]',
    'the preserved handbook still starts at phase 3',
  );

  // the expansion table follows the same bound
  vm.runInContext(
    `calculated={settings:{phase:'3'},stages:{1:{rows:[{id:'iron',machines:9}]},2:{rows:[{id:'iron',machines:9}]},3:{rows:[{id:'iron',machines:4}]},4:{rows:[{id:'iron',machines:6}]},5:{rows:[]}}};`,
    c,
  );
  const rows = JSON.parse(vm.runInContext(`JSON.stringify(calcExpansion('iron'))`, c));
  assert.equal(rows.length, 3, 'only the phases this profile builds are listed');
  assert.deepEqual(
    rows[0],
    { phase: '3', required: 4, add: '+4' },
    'the starting phase builds its own machines from scratch',
  );
});
