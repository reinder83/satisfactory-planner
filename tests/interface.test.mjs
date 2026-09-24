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
test('original and calculated views render; wizard exposes all settings and safe names', () => {
  const c = ui();
  // Profiles, account, backup, the plan and factories pages and the handbook's resources
  // page are Vue components, tested in tests/ui/.
  for (const route of ['renderStorage'])
    assert.ok(vm.runInContext(route + '()', c).length > 100, route);
  vm.runInContext(
    `calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};wizard={step:1,saveName:'World <one>',name:'Balanced',settings:structuredClone(generated.settings),preview:generated};`,
    c,
  );
  for (let step = 1; step <= 5; step++) {
    const text = vm.runInContext(`wizard.step=${step};renderWizard()`, c);
    assert.ok(text.includes('wizard-form'));
    assert.ok(!text.includes('value="World <one>"'));
  }
  assert.match(vm.runInContext('wizard.step=4;renderWizard()', c), /limitsConfirmed/);
  for (const route of ['renderCalculatedResources', 'renderStorage'])
    assert.ok(vm.runInContext(route + '()', c).length > 100, route);
  assert.ok(!vm.runInContext('renderStorage()', c).includes('<b>Ground floor is built.</b>'));
});

// Markup that was escaped as text: a tag shown on the page, or an entity escaped twice.
// Either means a string of markup reached html`` without raw() or its own html``.
const ESCAPED_MARKUP =
  /&lt;\/?(?:a|article|aside|b|br|button|div|form|h[1-6]|img|input|label|li|main|nav|option|p|section|select|small|span|strong|table|tbody|td|textarea|th|thead|tr|ul)\b|&amp;(?:amp|lt|gt|quot|#39);/;
test('every page escapes user text exactly once', () => {
  const c = ui();
  const evil = '<x-evil onclick=alert(1)> & "quoted"';
  c.evil = evil;
  vm.runInContext(
    `currentSave={id:'s',name:evil};currentProfile={id:'original',kind:'original',name:evil};workspace.saves=[{id:'s',name:evil,profiles:[{id:'original',kind:'original',name:evil,completed:0,phase:'3'},{id:'p',kind:'calculated',name:evil,completed:1,phase:'4',settings:{purity:evil,multiplier:1,powerFactor:1}}]}];workspace.accountsEnabled=true;workspace.user={id:'owner',username:evil};state.notes={global:evil,'phase-3':evil};`,
    c,
  );
  const render = routes => routes.map(route => [route, vm.runInContext(route + '()', c)]);
  // The pages that are Vue components are covered by tests/ui/.
  const shared = ['renderStorage'];
  const original = render(shared);
  vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:evil};`, c);
  const calculatedPages = render([...shared, 'renderCalculatedResources']);
  // The wizard's five steps and the guided start, adding a profile to the save.
  const wizardPages = [1, 2, 3, 4, 5, 'guided'].flatMap(step => {
    vm.runInContext(
      `wizard={step:${step === 'guided' ? 1 : step},saveId:'s',saveName:evil,name:evil,settings:structuredClone(generated.settings),preview:generated,carryFrom:null,carry:{},mode:${step === 'guided' ? "'guided'" : "'advanced'"},guidedStep:1,guidedAsk:null,tutorial:'doing'};`,
      c,
    );
    return render(['renderWizard']).map(([r, page]) => [r + ' ' + step, page]);
  });
  // Edit modes and dialogs, with the hostile text in every user-editable place they show.
  vm.runInContext(
    `calculated=null;currentProfile={id:'original',kind:'original',name:evil};state.customTasks=[{id:'custom-1',phase:'3',title:evil,body:evil}];state.factoryGroups={groups:[{id:'fg-a',name:evil}],assignments:{wire:[{group:'fg-a',rate:null}],computer:[{group:'fg-a',rate:null}]}};state.storageEdits={bays:[{id:'S',name:evil,floor:'ground'}],slots:{S01:evil},bayNames:{A:evil}};state.notes['factory-computer']=evil;state.notes['slot-S01']=evil;planEditing=true;factoryEditing=true;layoutEditing=true;`,
    c,
  );
  const dialog = open => vm.runInContext(`${open};document.querySelector('#detail').innerHTML`, c);
  const editing = [
    ...render(['renderStorage']).map(([r, p]) => [r + ' editing', p]),
    ['container dialog', dialog(`openSlot('S01')`)],
  ];
  vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:evil};`, c);
  editing.push([
    'alternate recipe dialog',
    dialog(`openAltRecipe(workspace.catalog.alternates[0].id)`),
  ]);
  const all = [...original, ...calculatedPages, ...wizardPages, ...editing];
  for (const [route, page] of all) {
    assert.equal(typeof page, 'string', route);
    assert.ok(!page.includes('<x-evil'), route + ' inserted user text as markup');
    assert.doesNotMatch(page, ESCAPED_MARKUP, route + ' escaped its own markup');
  }
  // The escaped name is there, once-escaped, on the pages that show it.
  const escaped = '&lt;x-evil onclick=alert(1)&gt; &amp; &quot;quoted&quot;';
  for (const [route, page] of all.filter(([r]) =>
    ['renderWizard 1', 'renderWizard guided', 'container dialog'].includes(r),
  ))
    assert.ok(page.includes(escaped), route);
});

test('storage layout edits render custom floors, bays and assignments; missing edits render the handbook', () => {
  const c = ui();
  vm.runInContext(`floor='ground'`, c);
  assert.ok(
    vm.runInContext('renderStorage()', c).includes('data-slot="A01"'),
    'legacy state without storageEdits renders the handbook layout',
  );
  vm.runInContext(
    `state.storageEdits={floors:[{id:'cf-abcd12',label:'Basement'}],floorNames:{ground:'Main hall'},bays:[{id:'S',name:'Overflow',floor:'cf-abcd12'}],bayNames:{A:'Renamed ingots'},slots:{S01:'Iron Plate<x>'},clearedSlots:['A01']};`,
    c,
  );
  const ground = vm.runInContext('renderStorage()', c);
  assert.match(ground, /Renamed ingots/);
  assert.match(ground, /Main hall/);
  assert.match(ground, /Basement/);
  assert.ok(!ground.includes('data-slot="A01"'), 'cleared containers show as reserved');
  const custom = vm.runInContext(`floor='cf-abcd12';renderStorage()`, c);
  assert.match(custom, /data-slot="S01"/);
  assert.match(custom, /Iron Plate&lt;x&gt;/, 'custom container names are escaped');
  const editing = vm.runInContext('layoutEditing=true;renderStorage()', c);
  assert.match(editing, /data-remove-bay="S"/);
  assert.match(editing, /data-bay-rename="S"/);
  assert.match(editing, /add-container/);
  assert.match(editing, /data-remove-floor="cf-abcd12"/);
  vm.runInContext(`layoutEditing=false;floor='ground';state.storageEdits=undefined;`, c);
  assert.ok(vm.runInContext('renderStorage()', c).includes('data-slot="A01"'));
  assert.equal(vm.runInContext('nextBayLetter()', c), 'S');
});

test('storage bays stay in address order in the document and take their hall position from the grid', () => {
  const c = ui();
  const html = vm.runInContext(`floor='ground';renderStorage()`, c);
  const letters = [...html.matchAll(/class="bay-letter">([A-Z]+)</g)].map(m => m[1]);
  assert.ok(
    letters.length > 2 && letters.length % 2 === 0,
    'the ground floor has whole rows of bays to order',
  );
  assert.deepEqual(letters, [...letters].sort(), 'a single narrow column reads alphabetically');
  const at = Object.fromEntries(
    [...html.matchAll(/--bay-row:([0-9]+);--bay-col:([0-9]+)[^]*?bay-letter">([A-Z]+)</g)].map(
      m => [m[3], [Number(m[1]), Number(m[2])]],
    ),
  );
  assert.deepEqual(at.A, [letters.length / 2, 1], 'A stays at the entrance, left of the aisle');
  assert.deepEqual(at.B, [letters.length / 2, 3], 'B stays at the entrance, right of the aisle');
  assert.deepEqual(
    at[letters.at(-2)],
    [1, 1],
    'the last pair of bays stays at the rear of the hall',
  );
  assert.equal(
    [...html.matchAll(/class="aisle"/g)].length,
    letters.length / 2,
    'every row keeps its aisle',
  );
  assert.match(
    html,
    /eyebrow floor-marker">REAR OF HALL/,
    'the orientation markers can be hidden when stacked',
  );
});

test('a bay grows past eight containers and keeps offering the next address', () => {
  const c = ui();
  vm.runInContext(
    `floor='ground';layoutEditing=true;state.storageEdits={floors:[],floorNames:{},bays:[],bayNames:{},slots:{A10:'Aluminum Casing'},clearedSlots:[]};`,
    c,
  );
  const html = vm.runInContext('renderStorage()', c);
  assert.match(html, /data-slot="A08"/, 'the printed positions keep their addresses');
  assert.match(
    html,
    /<strong>A09<\/strong><span>Reserved<\/span>/,
    'the gap up to the added container is reserved',
  );
  assert.match(html, /data-slot="A10"/, 'the added container renders at its own address');
  assert.match(
    html,
    /ADDED POSITIONS/,
    'added positions are marked off from the two printed banks',
  );
  assert.ok(
    !html.includes('data-slot="A11"'),
    'the bay is only as long as its highest filled address',
  );
  const full = vm.runInContext(
    `state.storageEdits.slots=Object.fromEntries(Array.from({length:bayCapacity-8},(_,i)=>['A'+(i+9),'Item '+i]));renderStorage()`,
    c,
  );
  assert.match(
    full,
    new RegExp(`data-slot="A${bayCapacity}"`),
    'a bay can reach the last addressable position',
  );
  assert.ok(
    !/<form class="inline-form add-container" data-bay="A"/.test(full),
    'a bay with no address left stops offering one',
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

test('storage follows the selected contract, preserves addresses and displays small power in MW', () => {
  const c = ui();
  vm.runInContext(
    `calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Building stock'};floor='ground';`,
    c,
  );
  const storage = vm.runInContext('renderStorage()', c);
  assert.match(storage, /Iron Plate/);
  assert.ok(!storage.includes('data-slot="G01"'));
  vm.runInContext(
    `calculated=structuredClone(generated);for(const stage of Object.values(calculated.stages))stage.storage={};calculated.settings.storage='none';calculated.settings.collectables=false;`,
    c,
  );
  assert.ok(!vm.runInContext('renderStorage()', c).includes('data-slot='));
  assert.equal(vm.runInContext('power(500)', c), '500 MW');
  assert.equal(vm.runInContext('power(1000)', c), (1000).toLocaleString() + ' MW');
  assert.equal(vm.runInContext('power(1500)', c), (1.5).toLocaleString() + ' GW');
});
test('wizard tabs retain edits and recalculate Review without native help tooltips', async () => {
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
  const html = vm.runInContext('renderWizard()', c);
  assert.equal((html.match(/data-wizard-step=/g) || []).length, 5);
  const help = vm.runInContext('help("purity")', c);
  assert.ok(!help.includes(' title='));
  assert.ok(help.includes('aria-label='));
  assert.ok(help.includes('role="tooltip"'));
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

test('the wizard can pick specific alternate recipes', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'S',name:'P',settings:{...structuredClone(generated.settings),recipes:'custom',alternateRecipes:['Recipe_Alternate_ReinforcedIronPlate_2_C']}};`,
    c,
  );
  const html = vm.runInContext('renderWizard()', c);
  assert.match(html, /alt-picker/, 'custom recipe access shows the alternate picker');
  assert.match(
    html,
    /name="alt" value="Recipe_Alternate_ReinforcedIronPlate_2_C" checked/,
    'picked alternates are pre-checked',
  );
  assert.match(html, /Stitched Iron Plate/);
  assert.match(
    html,
    /data-alt-info="Recipe_Alternate_ReinforcedIronPlate_2_C"/,
    'each alternate offers a recipe pop-out',
  );
  vm.runInContext('openAltRecipe("Recipe_Alternate_ReinforcedIronPlate_2_C")', c);
  const pop = vm.runInContext('document.querySelector("#detail").innerHTML', c);
  assert.match(pop, /rail-recipe/, 'the pop-out shows the recipe card');
  assert.match(
    pop,
    /Standard recipe for Reinforced Iron Plate/,
    'the standard recipe is shown for comparison',
  );
  assert.match(html, /MAM research/, 'MAM-researched recipes are labelled');
  assert.match(
    html,
    /name="alt" value="Recipe_Alternate_Turbofuel_C"/,
    'MAM recipes are normal picks with a neutral power choice',
  );
  const turbo = vm.runInContext(`wizard.settings.mainPower='turbofuel';renderWizard()`, c);
  assert.match(
    turbo,
    /required by your power preference/,
    'a turbofuel power route locks the MAM recipes on',
  );
  assert.ok(
    !turbo.includes('name="alt" value="Recipe_Alternate_Turbofuel_C"'),
    'locked MAM recipes are not editable picks',
  );
  vm.runInContext(`wizard.settings.mainPower='auto';wizard.settings.recipes='custom';`, c);
  assert.match(
    html,
    /name="alt" value="Recipe_Alternate_PureIronIngot_C"/,
    'pure recipes are normal picks by default',
  );
  const pure = vm.runInContext(`wizard.settings.pureIngots=true;renderWizard()`, c);
  assert.match(
    pure,
    /required by your ingot preference/,
    'requiring pure ingots locks the pure recipes on',
  );
  assert.ok(
    !pure.includes('name="alt" value="Recipe_Alternate_PureIronIngot_C"'),
    'locked pure recipes are not editable picks',
  );
  assert.ok(!html.includes('Charcoal'), 'recipes beyond Phase 5 are not offered');
  assert.match(html, /data-alt-best/, 'the picker offers the planner’s choice helper');
  assert.match(
    html,
    /name="altpref" value="Recipe_Alternate_ReinforcedIronPlate_2_C" checked=""|name="altpref" value="Recipe_Alternate_ReinforcedIronPlate_2_C"/,
    'picked rows offer a prefer star',
  );
  assert.match(html, /data-alt-all/, 'the picker offers select-shown');
  assert.match(html, /data-alt-none/, 'the picker offers clear-shown');
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
  vm.runInContext(`wizard.settings.pureIngots=false;`, c);
  assert.ok(
    !vm.runInContext(`wizard.settings.recipes='standard';renderWizard()`, c).includes('alt-picker'),
    'the picker only shows for custom access',
  );
  vm.runInContext('wizard=null', c);
});

test('adding a profile to an existing save offers to carry its progress over', () => {
  const c = ui();
  vm.runInContext(
    `workspace.saves=[{id:'s1',name:'One world',activeProfile:'p2',profiles:[{id:'p1',name:'First <plan>',kind:'calculated',settings:generated.settings},{id:'p2',name:'Second',kind:'calculated',settings:generated.settings}]}];`,
    c,
  );
  vm.runInContext(
    `wizard={step:5,saveId:'s1',saveName:'One world',name:'Third',settings:structuredClone(generated.settings),preview:generated,carryFrom:'p2',carry:Object.fromEntries(carryOptions.map(([k])=>[k,true]))};`,
    c,
  );
  const html = vm.runInContext('renderWizard()', c);
  assert.match(html, /carry-list/, 'the review step offers the carry-over options');
  assert.match(html, /name="carryFrom"/, 'the source profile can be chosen');
  assert.match(html, /value="p1"/, 'other profiles of the same save are offered');
  assert.match(html, /value="p2" selected/, 'the profile being continued is preselected');
  assert.ok(!html.includes('First <plan>'), 'profile names are escaped');
  for (const key of [
    'unlocks',
    'storage',
    'commissioning',
    'deliveries',
    'notes',
    'planEdits',
    'factories',
  ])
    assert.match(
      html,
      new RegExp(`name="carry" value="${key}" checked`),
      key + ' is carried by default',
    );
  assert.ok(
    !html.includes('value="picked"'),
    'recipe picks are only offered when the plan picks its own recipes',
  );
  vm.runInContext(
    `wizard.preview={...generated,settings:{...generated.settings,recipes:'custom',alternateRecipes:['Recipe_Alternate_Screw_C']}};`,
    c,
  );
  assert.match(
    vm.runInContext('renderWizard()', c),
    /name="carry" value="picked" checked/,
    'hand-picked recipes can be claimed as unlocked',
  );
  assert.match(
    vm.runInContext('renderWizard()', c),
    /<\/b> \(1\)/,
    'the number of recipes the claim covers is shown',
  );
  vm.runInContext(`wizard.saveId=null;`, c);
  assert.ok(
    !vm.runInContext('renderWizard()', c).includes('carry-list'),
    'a brand new save has nothing to carry',
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
});

test('the wizard keeps every preference field beside the somersloop ledger', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'W',name:'P',settings:{...structuredClone(generated.settings),somersloops:104,augmenters:1,fueledAugmenters:1,sloopReserved:['shards']},preview:null};`,
    c,
  );
  const html = vm.runInContext('renderWizard()', c);
  for (const name of [
    'cellsPerMinute',
    'storageRate',
    'buildRate',
    'somersloops',
    'augmenters',
    'fueledAugmenters',
    'amplifySloops',
  ])
    assert.ok(html.includes('name="' + name + '"'), 'step 2 lost the ' + name + ' field');
  assert.equal((html.match(/name="sloop"/g) || []).length, 3);
  assert.ok(
    html.includes('Committed: <b>11</b> of 104 available'),
    'the ledger totals what the plan commits',
  );
  assert.ok(
    html.includes('5 Alien Power Matrix/min'),
    'the ledger derives the fuel rate from the augmenter count',
  );
});
test('the wizard offers two storage rates and per-item overrides', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'World',name:'Balanced',settings:{...structuredClone(generated.settings),storage:'all',storageRate:1,buildRate:30,storageOverrides:{Concrete:60}},preview:null};`,
    c,
  );
  const html = vm.runInContext('renderWizard()', c);
  assert.match(
    html,
    /name="buildRate" type="number" value="30"/,
    'the construction rate is its own field',
  );
  assert.match(
    html,
    /name="storageRate" type="number" value="1"/,
    'the general rate stays a separate field',
  );
  assert.match(html, /rate-list/, 'per-item rates are offered');
  assert.match(html, /name="rate:Concrete"[^>]*value="60"/, 'an overridden item shows its rate');
  assert.match(
    html,
    /name="rate:Screws"[^>]*value=""/,
    'an item without an override is left blank',
  );
  assert.match(
    html,
    /name="rate:Iron Plate"[^>]*placeholder="30"/,
    'construction materials show the build rate as their placeholder',
  );
  assert.match(
    html,
    /name="rate:Screws"[^>]*placeholder="1"/,
    'other items show the general rate as their placeholder',
  );
  assert.match(html, /1 set/, 'the summary counts the overrides');

  vm.runInContext(`wizard.settings.storage='construction';`, c);
  const narrow = vm.runInContext('renderWizard()', c);
  assert.match(narrow, /name="rate:Concrete"/, 'the list follows the selected storage supply');
  assert.ok(
    !narrow.includes('name="rate:Ballistic Warp Drive"'),
    'items outside the contract are not listed',
  );
  vm.runInContext(`wizard.settings.storage='none';`, c);
  assert.ok(
    !vm.runInContext('renderWizard()', c).includes('rate-list'),
    'no dedicated storage means no rates to set',
  );

  vm.runInContext(`wizard.settings.storage='all';wizard.settings.storageOverrides={};`, c);
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

test('editing a group rate refreshes the per-item placeholders it applies to', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:2,saveName:'World',name:'Balanced',settings:{...structuredClone(generated.settings),storage:'all',storageRate:1,buildRate:30,storageOverrides:{}},preview:null};`,
    c,
  );
  const html = vm.runInContext('renderWizard()', c);
  assert.match(
    html,
    /data-rate-group="build"[^>]*>\s*<span>Concrete/,
    'construction rows say which rate they follow',
  );
  assert.match(
    html,
    /data-rate-group="delivered"[^>]*>\s*<span>Nuclear Pasta/,
    'delivered rows say which rate they follow',
  );
  assert.match(
    html,
    /data-rate-group="other"[^>]*>\s*<span>Screws/,
    'everything else follows the general rate',
  );

  // A stand-in for the rendered list: one row per group, plus the two rate fields.
  const rows = [
    ['build', { placeholder: '30' }],
    ['delivered', { placeholder: '0' }],
    ['other', { placeholder: '1' }],
  ].map(([group, input]) => ({ dataset: { rateGroup: group }, querySelector: () => input, input }));
  const fields = { storageRate: { value: '1' }, buildRate: { value: '30' } };
  c.document.querySelectorAll = sel => (sel === '.rate-row' ? rows : []);
  c.document.querySelector = sel => fields[sel.replace('[name=', '').replace(']', '')] || null;

  fields.buildRate.value = '45';
  vm.runInContext('refreshRatePlaceholders()', c);
  assert.equal(rows[0].input.placeholder, '45', 'construction boxes follow the construction rate');
  assert.equal(rows[2].input.placeholder, '1', 'the general boxes are untouched');
  assert.equal(rows[1].input.placeholder, '0', 'delivered parts stay at zero');

  fields.storageRate.value = '4';
  vm.runInContext('refreshRatePlaceholders()', c);
  assert.equal(rows[2].input.placeholder, '4', 'the general boxes follow the general rate');
  assert.equal(rows[0].input.placeholder, '45', 'the construction boxes keep their own rate');

  fields.buildRate.value = '';
  vm.runInContext('refreshRatePlaceholders()', c);
  assert.equal(
    rows[0].input.placeholder,
    '4',
    'an empty construction rate falls back to the general rate, as the planner does',
  );
  fields.storageRate.value = '';
  vm.runInContext('refreshRatePlaceholders()', c);
  assert.equal(
    rows[2].input.placeholder,
    '4',
    'a half-typed rate leaves the last usable placeholder in place',
  );
});

test('the wizard chooses what the target time applies to and Review shows what a phase used to take', () => {
  const c = ui();
  vm.runInContext(
    `wizard={step:3,saveName:'World',name:'Balanced',settings:{...structuredClone(generated.settings),goal:'timed',hours:10},preview:null};`,
    c,
  );
  const goals = vm.runInContext('renderWizard()', c);
  assert.match(goals, /name="phaseTime"/, 'the goals step asks what the target time applies to');
  assert.match(goals, /value="every" selected/, 'every phase is the default');
  vm.runInContext(`wizard.settings.phaseTime='final';`, c);
  assert.match(
    vm.runInContext('renderWizard()', c),
    /value="final" selected/,
    'the saved choice is shown',
  );
  assert.match(
    vm.runInContext(`String(help('phaseTime'))`, c),
    /final phase/,
    'the choice is explained',
  );

  vm.runInContext(
    `wizard.step=5;wizard.preview={...generated,settings:{...generated.settings,phase:'1'},stages:{...generated.stages,1:{...generated.stages[1],hours:5.21,aheadOf:9.92}}};`,
    c,
  );
  const review = vm.runInContext('renderWizard()', c);
  assert.match(review, /was 9.92 h/, 'a pulled-forward phase shows what it used to take');
  vm.runInContext(`wizard.preview=generated;`, c);
  assert.ok(
    !vm.runInContext('renderWizard()', c).includes('was '),
    'an ordinary plan shows no such note',
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
  // Review must not flag a phase the profile will never offer.
  vm.runInContext(
    `wizard={step:5,saveName:'W',name:'P',settings:{...generated.settings,phase:'4'},preview:{...generated,settings:{...generated.settings,phase:'4'},stages:{...generated.stages,3:{feasible:false,reason:'Earlier phase shortfall'},5:{feasible:false,reason:'Later phase shortfall'}}},carryFrom:null,carry:{}};`,
    c,
  );
  const review = vm.runInContext('renderWizard()', c);
  assert.ok(!review.includes('Earlier phase shortfall'), 'a phase behind the start is not flagged');
  assert.ok(review.includes('Later phase shortfall'), 'a phase the profile plans is still flagged');

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
