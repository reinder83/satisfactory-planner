import {droneFuels,storageOptions,distributions,purities,powerOptions,resourceDefaults,helpText,wantsStorage,storageRateFor} from '../public/preferences.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {progression} from '../public/progression.js';
import {carryOptions,pickedRecipeUnlocks} from '../public/state.js';
import {calculate,catalog} from '../planner.mjs';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^(?:import[^\n]*\n)+/,'').replaceAll('import.meta.url',JSON.stringify('https://example.com/satisfactory-planner/app.js')).replace(/\nboot\(\);\s*$/,'');
function ui(){const node={addEventListener(){},close(){},showModal(){},innerHTML:''};const c=vm.createContext({document:{querySelector:()=>node,querySelectorAll:()=>[],addEventListener(){},activeElement:null},window:{addEventListener(){},scrollTo(){}},location:{hash:'#plan'},console,setTimeout,clearTimeout,URL,JSON,structuredClone,browserMode:false,progression,carryOptions,pickedRecipeUnlocks,droneFuels,storageOptions,distributions,purities,powerOptions,resourceDefaults,helpText,wantsStorage,storageRateFor});vm.runInContext(source,c);c.fixture=JSON.parse(fs.readFileSync(new URL('../public/plan.json',import.meta.url),'utf8'));c.catalogData=catalog();c.progressionFixture=JSON.parse(fs.readFileSync(new URL('../public/progression.json',import.meta.url),'utf8'));c.generated=calculate({});vm.runInContext(`plan=fixture;progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World <one>'};currentProfile={id:'original',kind:'original',name:'Original'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};`,c);return c;}
test('original and calculated views render; wizard exposes all settings and safe names',()=>{
 const c=ui();for(const route of ['renderPlan','renderFactories','renderStorage','renderResources','renderBackup','renderProfiles','renderAccount'])assert.ok(vm.runInContext(route+'()',c).length>100,route);
 vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};wizard={step:1,saveName:'World <one>',name:'Balanced',settings:structuredClone(generated.settings),preview:generated};`,c);
 for(let step=1;step<=5;step++){const text=vm.runInContext(`wizard.step=${step};renderWizard()`,c);assert.ok(text.includes('wizard-form'));assert.ok(!text.includes('value="World <one>"'));}
 assert.match(vm.runInContext('wizard.step=4;renderWizard()',c),/limitsConfirmed/);
 for(const route of ['renderCalculatedPlan','renderCalculatedFactories','renderCalculatedResources','renderCalculatedBackup','renderStorage'])assert.ok(vm.runInContext(route+'()',c).length>100,route);
 assert.ok(!vm.runInContext('renderStorage()',c).includes('<b>Ground floor is built.</b>'));
 vm.runInContext(`state.settings.phase='1'`,c);assert.ok(vm.runInContext('renderCalculatedPlan()',c).includes('Phase 1'));
});


test('storage layout edits render custom floors, bays and assignments; missing edits render the handbook',()=>{
 const c=ui();
 vm.runInContext(`floor='ground'`,c);
 assert.ok(vm.runInContext('renderStorage()',c).includes('data-slot="A01"'),'legacy state without storageEdits renders the handbook layout');
 vm.runInContext(`state.storageEdits={floors:[{id:'cf-abcd12',label:'Basement'}],floorNames:{ground:'Main hall'},bays:[{id:'S',name:'Overflow',floor:'cf-abcd12'}],bayNames:{A:'Renamed ingots'},slots:{S01:'Iron Plate<x>'},clearedSlots:['A01']};`,c);
 const ground=vm.runInContext('renderStorage()',c);
 assert.match(ground,/Renamed ingots/);
 assert.match(ground,/Main hall/);
 assert.match(ground,/Basement/);
 assert.ok(!ground.includes('data-slot="A01"'),'cleared containers show as reserved');
 const custom=vm.runInContext(`floor='cf-abcd12';renderStorage()`,c);
 assert.match(custom,/data-slot="S01"/);
 assert.match(custom,/Iron Plate&lt;x&gt;/,'custom container names are escaped');
 const editing=vm.runInContext('layoutEditing=true;renderStorage()',c);
 assert.match(editing,/data-remove-bay="S"/);
 assert.match(editing,/data-bay-rename="S"/);
 assert.match(editing,/add-container/);
 assert.match(editing,/data-remove-floor="cf-abcd12"/);
 vm.runInContext(`layoutEditing=false;floor='ground';state.storageEdits=undefined;`,c);
 assert.ok(vm.runInContext('renderStorage()',c).includes('data-slot="A01"'));
 assert.equal(vm.runInContext('nextBayLetter()',c),'S');
});

test('machine instructions separate total, full-speed and adjustable machines',()=>{
 const c=ui();c.row={name:'Rubber',machine:'Refinery',machines:3,equivalent:2.4017,lastClock:40.17,outputs:{Rubber:48.034,'Heavy Oil Residue':48.034},inputs:{'Crude Oil':72.051}};
 const setup=vm.runInContext('machineSetup(row)',c);assert.equal(setup.whole,2);assert.equal(setup.partial,true);assert.match(setup.summary,/3 Refinery total: 2 at 100% \+ 1 adjustable/);assert.equal(setup.easy.clock,45);assert.equal(setup.easy.output.Rubber,9);
 c.row={...c.row,equivalent:3,lastClock:100,outputs:{Rubber:60},inputs:{'Crude Oil':90}};const full=vm.runInContext('machineSetup(row)',c);assert.equal(full.partial,false);assert.match(full.summary,/3 at 100%/);
});

test('shared sites group their outputs above the individual factory list',()=>{
 const c=ui();
 const p3=vm.runInContext('renderFactories()',c);
 assert.match(p3,/Oil campus/);
 assert.match(p3,/SHARED SITE · 2 OUTPUTS/);
 assert.equal((p3.match(/data-factory="plastic"/g)||[]).length,2,'Plastic appears only inside the oil campus group');
 assert.ok(p3.indexOf('Oil campus')<p3.indexOf('UNGROUPED FACTORIES'),'shared sites render above the main grid');
 assert.ok(!p3.includes('Nuclear site'),'no nuclear factories at Phase 3');
 vm.runInContext(`state.settings.phase='5'`,c);
 const p5=vm.runInContext('renderFactories()',c);
 assert.match(p5,/Nuclear site/);
 assert.match(p5,/data-factory="uranium-fuel-rod"/);
 vm.runInContext(`query='plastic'`,c);
 const filtered=vm.runInContext('renderFactories()',c);
 assert.match(filtered,/Oil campus/);
 assert.ok(!filtered.includes('Nuclear site')&&!filtered.includes('UNGROUPED FACTORIES'),'empty groups and labels disappear when filtering');
 assert.ok(!filtered.includes('No factories match'),'no empty state while a group still matches');
 vm.runInContext(`query='';state.settings.phase='3'`,c);
});
test('plan and factory edit modes render controls, groups, splits and factory links',()=>{
 const c=ui();
 vm.runInContext(`state.factoryGroups={groups:[{id:'fg-cable01',name:'Cable factory'},{id:'fg-plates1',name:'Stitched plates'}],assignments:{wire:[{group:'fg-cable01',rate:300},{group:'fg-plates1',rate:null}]}};`,c);
 const grouped=vm.runInContext('renderFactories()',c);
 assert.match(grouped,/Cable factory/);
 assert.match(grouped,/FACTORY GROUP · 1 FACTORY/);
 assert.match(grouped,/Here: 300\/min/,'a split shows the allocated production');
 assert.match(grouped,/Remaining here:/,'the rateless membership shows the remainder');
 const editing=vm.runInContext('factoryEditing=true;renderFactories()',c);
 assert.match(editing,/id="add-group"/);
 assert.match(editing,/data-group-rename="fg-cable01"/);
 assert.match(editing,/data-assign-rate="wire"/);
 assert.match(editing,/data-unassign="wire"/);
 vm.runInContext('factoryEditing=false',c);
 vm.runInContext(`state.taskEdits={order:{},removed:['phase-3-survey'],titles:{'phase-3-iron':'Iron halls renamed'},bodies:{},links:{'phase-3-retire-power':'wire'}};`,c);
 const planHtml=vm.runInContext('renderPlan()',c);
 assert.ok(!planHtml.includes('Survey the iron site'),'removed steps disappear from the plan');
 assert.match(planHtml,/Iron halls renamed/);
 assert.match(planHtml,/Open factory: Wire/,'linked steps offer the factory');
 const editPlan=vm.runInContext('planEditing=true;renderPlan()',c);
 assert.match(editPlan,/data-move-task=/);
 assert.match(editPlan,/Removed steps in this phase \(1\)/);
 assert.match(editPlan,/data-restore-task="phase-3-survey"/);
 assert.match(vm.runInContext(`editingTask='phase-3-iron';renderPlan()`,c),/data-task-edit="phase-3-iron"/);
 vm.runInContext(`planEditing=false;editingTask=null;state.taskEdits=undefined;state.factoryGroups=undefined;`,c);
 vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};`,c);
 assert.match(vm.runInContext('renderCalculatedPlan()',c),/Open factory: /,'calculated steps link to their production line');
 vm.runInContext(`state.factoryGroups={groups:[{id:'fg-north1',name:'North site'}],assignments:{'iron-ingot':[{group:'fg-north1',rate:null}]}};`,c);
 const calcGroups=vm.runInContext('factoryEditing=true;renderCalculatedFactories()',c);
 assert.match(calcGroups,/North site/);
 assert.match(calcGroups,/data-assign-add=/);
 vm.runInContext(`factoryEditing=false;calculated=null;state.factoryGroups=undefined;currentProfile={id:'original',kind:'original',name:'Original'};`,c);
});

test('the build plan checklist can be searched and can hide completed steps',()=>{
 const c=ui();
 const all=vm.runInContext('renderPlan()',c);
 assert.match(all,/id="plan-search"/,'the plan offers a step search');
 assert.match(all,/id="hide-done"/,'the plan offers a hide-completed toggle');
 assert.match(all,/Survey the iron site/);
 const searched=vm.runInContext(`query='steel';renderPlan()`,c);
 assert.match(searched,/data-check="phase-3-steel"/);
 assert.ok(!searched.includes('data-check="phase-3-survey"'),'search hides non-matching steps');
 assert.match(searched,/1 of 9 steps/,'the toolbar counts the filtered steps');
 assert.match(vm.runInContext(`query='no-such-step';renderPlan()`,c),/No steps match this search\./);
 const hidden=vm.runInContext(`query='';state.checks={'phase-3-survey':true};hideDone=true;renderPlan()`,c);
 assert.ok(!hidden.includes('data-check="phase-3-survey"'),'completed steps are hidden');
 assert.match(hidden,/data-check="phase-3-iron"/,'unfinished steps stay visible');
 assert.match(hidden,/8 of 9 steps/);
 assert.match(hidden,/1 <span class="fraction">\/ 9<\/span>/,'progress stats keep counting every step');
 const done=vm.runInContext(`state.checks=Object.fromEntries(planTasks().map(t=>[t.id,true]));renderPlan()`,c);
 assert.match(done,/Every step of this phase is completed/,'an all-hidden checklist explains the toggle');
 vm.runInContext(`state.checks={'calc-3-x':true};calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};`,c);
 const calc=vm.runInContext('renderCalculatedPlan()',c);
 assert.match(calc,/id="plan-search"/,'the calculated plan gets the same tools');
 assert.match(calc,/id="hide-done" checked/,'the toggle stays ticked across plan views');
 vm.runInContext(`hideDone=false;query='';state.checks={};calculated=null;currentProfile={id:'original',kind:'original',name:'Original'};`,c);
});

test('factory details list where a local item is needed',()=>{
 const c=ui();
 vm.runInContext(`openFactory('wire')`,c);
 const wire=vm.runInContext(`document.querySelector('#detail').innerHTML`,c);
 assert.match(wire,/Delivers · Phase 3/);
 assert.match(wire,/Machines per delivery/,'delivery rows show machine counts per consumer');
 assert.match(wire,/data-factory="cable"/,'consumers link to their own factory page');
 assert.match(wire,/Storage refill/);
 vm.runInContext(`openFactory('screws')`,c);
 const screws=vm.runInContext(`document.querySelector('#detail').innerHTML`,c);
 assert.match(screws,/Storage refill/);
 assert.match(screws,/only refills the protected storage/,'items without factory consumers say so');
 vm.runInContext(`openFactory('smart-plating')`,c);
 const plating=vm.runInContext(`document.querySelector('#detail').innerHTML`,c);
 assert.match(plating,/data-factory="modular-engine"/,'non-local factories get the breakdown too');
 assert.ok(!plating.includes('only refills the protected storage'));
 vm.runInContext(`openFactory('modular-engine')`,c);
 assert.match(vm.runInContext(`document.querySelector('#detail').innerHTML`,c),/Space Elevator delivery/);
 vm.runInContext(`state.settings.phase='5';openFactory('uranium-fuel-rod')`,c);
 const rod=vm.runInContext(`document.querySelector('#detail').innerHTML`,c);
 assert.match(rod,/nuclear power fleet/,'nuclear items point at the power plan instead of claiming storage');
 assert.ok(!rod.includes('only refills the protected storage'));
 vm.runInContext(`state.settings.phase='3';openFactory('reinforced-iron-plate')`,c);
 const rip=vm.runInContext(`document.querySelector('#detail').innerHTML`,c);
 assert.match(rip,/Local: ≈ 47 × Constructor at this site/,'local inputs show on-site machine counts');
 assert.match(rip,/data-factory="wire"/);
 assert.match(rip,/Recipe · Stitched Iron Plate/,'the per-machine recipe panel names the chosen recipe');
 vm.runInContext(`openFactory('plastic')`,c);
 const plastic=vm.runInContext(`document.querySelector('#detail').innerHTML`,c);
 assert.match(plastic,/179 shared campus buildings/,'oil expansion counts the shared campus instead of 0 refineries');
 assert.match(plastic,/\+1[.,]242/,'campus growth between phases is shown as added buildings');
 assert.match(plastic,/Campus inputs/,'the campus layout lists crude and water supply');
 assert.match(plastic,/Fuel Generators/,'phase 3 fuel byproduct points at the generator bank');
 vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};`,c);
 const calc=vm.runInContext(`(()=>{const x=calcStage();const r=x.rows.find(r=>Object.keys(r.outputs).some(n=>x.rows.some(o=>o.id!==r.id&&o.inputs[n])));openCalculatedFactory(r.id);return document.querySelector('#detail').innerHTML;})()`,c);
 assert.match(calc,/Delivers · /);
 assert.match(calc,/data-calc-factory=/);
});
test('group build order stages suppliers before consumers with needs and feeds',()=>{
 const c=ui();
 vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};`,c);
 const names=vm.runInContext(`(()=>{
  const x=calcStage();
  const consumer=x.rows.find(r=>x.rows.some(o=>o.id!==r.id&&Object.keys(o.outputs||{}).some(n=>r.inputs?.[n])));
  const supplier=x.rows.find(o=>o.id!==consumer.id&&Object.keys(o.outputs||{}).some(n=>consumer.inputs[n]));
  state.factoryGroups={groups:[{id:'fg-test01',name:'Chain test'}],assignments:{[supplier.id]:[{group:'fg-test01',rate:null}],[consumer.id]:[{group:'fg-test01',rate:null}]}};
  openGroupChain('fg-test01');
  return {supplier:supplier.name,consumer:consumer.name};
 })()`,c);
 const chain=vm.runInContext(`document.querySelector('#detail').innerHTML`,c);
 assert.match(chain,/build order/i);
 assert.match(chain,/Needs|No belt or pipe inputs/);
 assert.match(chain,/Feeds/);
 assert.match(chain,/data-calc-factory=/,'chain stages link to the factory dialogs');
 assert.ok(chain.indexOf('>'+names.supplier.replace(/&/g,'&amp;'))<=chain.indexOf('>'+names.consumer.replace(/&/g,'&amp;')),'supplier stage comes before its consumer');
 assert.match(vm.runInContext('renderCalculatedFactories()',c),/data-group-chain="fg-test01"/,'group headers offer the build order view');
 vm.runInContext(`calculated=null;state.factoryGroups=undefined;currentProfile={id:'original',kind:'original',name:'Original'};`,c);
});
test('storage follows the selected contract, preserves addresses and displays small power in MW',()=>{
 const c=ui();vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Building stock'};floor='ground';`,c);
 const storage=vm.runInContext('renderStorage()',c);
 assert.match(storage,/Iron Plate/);assert.ok(!storage.includes('data-slot="G01"'));
 vm.runInContext(`calculated=structuredClone(generated);for(const stage of Object.values(calculated.stages))stage.storage={};calculated.settings.storage='none';calculated.settings.collectables=false;`,c);
 assert.ok(!vm.runInContext('renderStorage()',c).includes('data-slot='));
 assert.equal(vm.runInContext('power(500)',c),'500 MW');
 assert.equal(vm.runInContext('power(1000)',c),(1000).toLocaleString()+' MW');
 assert.equal(vm.runInContext('power(1500)',c),(1.5).toLocaleString()+' GW');
});
test('wizard tabs retain edits and recalculate Review without native help tooltips',async()=>{
 const c=ui();vm.runInContext(`wizard={step:1,saveName:'World',name:'',settings:structuredClone(generated.settings),preview:generated};render=()=>{};`,c);
 const form={reportValidity:()=>true,querySelector:sel=>['.alt-list','.carry-list'].includes(sel)?null:{textContent:''}};c.document.querySelector=()=>form;
 c.FormData=class{*[Symbol.iterator](){yield ['saveName','Edited world'];yield ['purity','pure'];}has(){return false;}};
 await vm.runInContext('moveWizard(2)',c);
 assert.equal(vm.runInContext('wizard.saveName',c),'Edited world');
 assert.equal(vm.runInContext('wizard.settings.limits["Iron Ore"]',c),152400);
 assert.equal(vm.runInContext('wizard.preview',c),null);
 c.FormData=class{*[Symbol.iterator](){yield ['utilityPercent','35'];}has(){return false;}};
 vm.runInContext(`post=async(url,body)=>{if(body.settings.utilityPercent!==35)throw Error('Lost input');return generated;}`,c);
 await vm.runInContext('moveWizard(5)',c);assert.equal(vm.runInContext('wizard.step',c),5);
 const html=vm.runInContext('renderWizard()',c);assert.equal((html.match(/data-wizard-step=/g)||[]).length,5);
 const help=vm.runInContext('help("purity")',c);assert.ok(!help.includes(' title='));assert.ok(help.includes('aria-label='));assert.ok(help.includes('role="tooltip"'));
});

test('the wizard shows calculation progress and options when the calculation times out',async()=>{
 const c=ui();
 vm.runInContext(`wizard={step:4,saveName:'W',name:'P',settings:structuredClone(generated.settings),preview:null};render=()=>{};`,c);
 const errorNode={textContent:'',innerHTML:''};
 const submitNode={textContent:'Calculate plan'};
 const form={reportValidity:()=>true,querySelector:sel=>['.alt-list','.carry-list'].includes(sel)?null:sel==='button[type="submit"]'?submitNode:errorNode};
 c.document.querySelector=()=>form;
 c.FormData=class{*[Symbol.iterator](){}has(){return false;}getAll(){return [];}};
 c.buttonText=()=>submitNode.textContent;
 vm.runInContext(`let progressText='';post=async(url,body,scope,extra)=>{extra.onProgress(3);progressText=buttonText();throw Error('Calculation timed out. Try fewer alternate recipes or a smaller goal.');};`,c);
 await vm.runInContext('moveWizard(5)',c);
 assert.equal(vm.runInContext('progressText',c),'Calculating… Phase 3 of 5…','the submit button reports the phase being calculated');
 assert.equal(submitNode.textContent,'Calculate plan','the button label is restored after a failure');
 assert.match(errorNode.innerHTML,/timed out/,'the timeout message is shown');
 assert.match(errorNode.innerHTML,/Planner’s choice/,'the guidance suggests reducing picks with Planner’s choice');
 assert.match(errorNode.innerHTML,/whole-machine production/,'the guidance mentions the whole-machine setting');
 vm.runInContext(`post=async()=>{throw Error('Save not found.');}`,c);
 errorNode.innerHTML='';errorNode.textContent='';
 await vm.runInContext('moveWizard(5)',c);
 assert.equal(errorNode.textContent,'Save not found.','other errors stay plain text');
 assert.equal(errorNode.innerHTML,'','no guidance is attached to unrelated errors');
});

test('the wizard can pick specific alternate recipes',()=>{
 const c=ui();
 vm.runInContext(`wizard={step:2,saveName:'S',name:'P',settings:{...structuredClone(generated.settings),recipes:'custom',alternateRecipes:['Recipe_Alternate_ReinforcedIronPlate_2_C']}};`,c);
 const html=vm.runInContext('renderWizard()',c);
 assert.match(html,/alt-picker/,'custom recipe access shows the alternate picker');
 assert.match(html,/name="alt" value="Recipe_Alternate_ReinforcedIronPlate_2_C" checked/,'picked alternates are pre-checked');
 assert.match(html,/Stitched Iron Plate/);
 assert.match(html,/data-alt-info="Recipe_Alternate_ReinforcedIronPlate_2_C"/,'each alternate offers a recipe pop-out');
 vm.runInContext('openAltRecipe("Recipe_Alternate_ReinforcedIronPlate_2_C")',c);
 const pop=vm.runInContext('document.querySelector("#detail").innerHTML',c);
 assert.match(pop,/rail-recipe/,'the pop-out shows the recipe card');
 assert.match(pop,/Standard recipe for Reinforced Iron Plate/,'the standard recipe is shown for comparison');
 assert.match(html,/MAM research/,'MAM-researched recipes are labelled');
 assert.match(html,/name="alt" value="Recipe_Alternate_Turbofuel_C"/,'MAM recipes are normal picks with a neutral power choice');
 const turbo=vm.runInContext(`wizard.settings.mainPower='turbofuel';renderWizard()`,c);
 assert.match(turbo,/required by your power preference/,'a turbofuel power route locks the MAM recipes on');
 assert.ok(!turbo.includes('name="alt" value="Recipe_Alternate_Turbofuel_C"'),'locked MAM recipes are not editable picks');
 vm.runInContext(`wizard.settings.mainPower='auto';wizard.settings.recipes='custom';`,c);
 assert.match(html,/name="alt" value="Recipe_Alternate_PureIronIngot_C"/,'pure recipes are normal picks by default');
 const pure=vm.runInContext(`wizard.settings.pureIngots=true;renderWizard()`,c);
 assert.match(pure,/required by your ingot preference/,'requiring pure ingots locks the pure recipes on');
 assert.ok(!pure.includes('name="alt" value="Recipe_Alternate_PureIronIngot_C"'),'locked pure recipes are not editable picks');
 assert.ok(!html.includes('Charcoal'),'recipes beyond Phase 5 are not offered');
 assert.match(html,/data-alt-best/,'the picker offers the planner’s choice helper');
 assert.match(html,/name="altpref" value="Recipe_Alternate_ReinforcedIronPlate_2_C" checked=""|name="altpref" value="Recipe_Alternate_ReinforcedIronPlate_2_C"/,'picked rows offer a prefer star');
 assert.match(html,/data-alt-all/,'the picker offers select-shown');
 assert.match(html,/data-alt-none/,'the picker offers clear-shown');
 assert.equal(vm.runInContext('JSON.stringify(alternatesUsed(generated))',c),'["Recipe_Alternate_EnrichedCoal_C","Recipe_Alternate_Turbofuel_C"]','a standard plan uses no hard-drive alternates, but its turbofuel power chain still needs the MAM picks');
 assert.equal(vm.runInContext(`JSON.stringify(alternatesUsed({stages:{a:{rows:[{id:'x',alternate:true},{id:'y'}]},b:{rows:[{id:'x',alternate:true}]}}}))`,c),'["x"]','used alternates are collected uniquely across phases');
 assert.equal(vm.runInContext(`JSON.stringify(alternatesUsed({stages:{a:{rows:[{id:'Recipe_Alternate_Turbofuel_C',alternate:false},{id:'y'}]}}}))`,c),'["Recipe_Alternate_Turbofuel_C"]','MAM recipes count as used alternates even though plans mark them standard');
 vm.runInContext(`wizard.settings.pureIngots=false;`,c);
 assert.ok(!vm.runInContext(`wizard.settings.recipes='standard';renderWizard()`,c).includes('alt-picker'),'the picker only shows for custom access');
 vm.runInContext('wizard=null',c);
});

test('adding a profile to an existing save offers to carry its progress over',()=>{
 const c=ui();
 vm.runInContext(`workspace.saves=[{id:'s1',name:'One world',activeProfile:'p2',profiles:[{id:'p1',name:'First <plan>',kind:'calculated',settings:generated.settings},{id:'p2',name:'Second',kind:'calculated',settings:generated.settings}]}];`,c);
 vm.runInContext(`wizard={step:5,saveId:'s1',saveName:'One world',name:'Third',settings:structuredClone(generated.settings),preview:generated,carryFrom:'p2',carry:Object.fromEntries(carryOptions.map(([k])=>[k,true]))};`,c);
 const html=vm.runInContext('renderWizard()',c);
 assert.match(html,/carry-list/,'the review step offers the carry-over options');
 assert.match(html,/name="carryFrom"/,'the source profile can be chosen');
 assert.match(html,/value="p1"/,'other profiles of the same save are offered');
 assert.match(html,/value="p2" selected/,'the profile being continued is preselected');
 assert.ok(!html.includes('First <plan>'),'profile names are escaped');
 for(const key of ['unlocks','storage','commissioning','deliveries','notes','planEdits','factories'])assert.match(html,new RegExp(`name="carry" value="${key}" checked`),key+' is carried by default');
 assert.ok(!html.includes('value="picked"'),'recipe picks are only offered when the plan picks its own recipes');
 vm.runInContext(`wizard.preview={...generated,settings:{...generated.settings,recipes:'custom',alternateRecipes:['Recipe_Alternate_Screw_C']}};`,c);
 assert.match(vm.runInContext('renderWizard()',c),/name="carry" value="picked" checked/,'hand-picked recipes can be claimed as unlocked');
 assert.match(vm.runInContext('renderWizard()',c),/<\/b> \(1\)/,'the number of recipes the claim covers is shown');
 vm.runInContext(`wizard.saveId=null;`,c);
 assert.ok(!vm.runInContext('renderWizard()',c).includes('carry-list'),'a brand new save has nothing to carry');
 c.FormData=class{getAll(){return ['storage','factories'];}get(){return 'p1';}};
 vm.runInContext(`readCarry({querySelector:sel=>sel==='.carry-list'?{}:null})`,c);
 assert.equal(vm.runInContext('wizard.carryFrom',c),'p1','the chosen source profile is kept');
 assert.equal(vm.runInContext('wizard.carry.storage',c),true,'ticked options are kept');
 assert.equal(vm.runInContext('wizard.carry.notes',c),false,'unticked options are cleared');
});

test('the wizard offers two storage rates and per-item overrides',()=>{
 const c=ui();
 vm.runInContext(`wizard={step:2,saveName:'World',name:'Balanced',settings:{...structuredClone(generated.settings),storage:'all',storageRate:1,buildRate:30,storageOverrides:{Concrete:60}},preview:null};`,c);
 const html=vm.runInContext('renderWizard()',c);
 assert.match(html,/name="buildRate" type="number" value="30"/,'the construction rate is its own field');
 assert.match(html,/name="storageRate" type="number" value="1"/,'the general rate stays a separate field');
 assert.match(html,/rate-list/,'per-item rates are offered');
 assert.match(html,/name="rate:Concrete"[^>]*value="60"/,'an overridden item shows its rate');
 assert.match(html,/name="rate:Screws"[^>]*value=""/,'an item without an override is left blank');
 assert.match(html,/name="rate:Iron Plate"[^>]*placeholder="30"/,'construction materials show the build rate as their placeholder');
 assert.match(html,/name="rate:Screws"[^>]*placeholder="1"/,'other items show the general rate as their placeholder');
 assert.match(html,/1 set/,'the summary counts the overrides');

 vm.runInContext(`wizard.settings.storage='construction';`,c);
 const narrow=vm.runInContext('renderWizard()',c);
 assert.match(narrow,/name="rate:Concrete"/,'the list follows the selected storage supply');
 assert.ok(!narrow.includes('name="rate:Ballistic Warp Drive"'),'items outside the contract are not listed');
 vm.runInContext(`wizard.settings.storage='none';`,c);
 assert.ok(!vm.runInContext('renderWizard()',c).includes('rate-list'),'no dedicated storage means no rates to set');

 vm.runInContext(`wizard.settings.storage='all';wizard.settings.storageOverrides={};`,c);
 const form={querySelector:sel=>sel==='.rate-list'?{}:null,reportValidity:()=>true};
 c.FormData=class{*[Symbol.iterator](){yield ['rate:Concrete','60'];yield ['rate:Screws','0'];yield ['rate:Wire',''];}has(){return false;}getAll(){return [];}get(){return null;}};
 vm.runInContext('readWizard(form)',Object.assign(c,{form}));
 assert.equal(vm.runInContext('JSON.stringify(wizard.settings.storageOverrides)',c),'{"Concrete":60,"Screws":0}','blank boxes stay unset while zero is kept');
});

test('editing a group rate refreshes the per-item placeholders it applies to',()=>{
 const c=ui();
 vm.runInContext(`wizard={step:2,saveName:'World',name:'Balanced',settings:{...structuredClone(generated.settings),storage:'all',storageRate:1,buildRate:30,storageOverrides:{}},preview:null};`,c);
 const html=vm.runInContext('renderWizard()',c);
 assert.match(html,/data-rate-group="build"[^>]*>\s*<span>Concrete/,'construction rows say which rate they follow');
 assert.match(html,/data-rate-group="delivered"[^>]*>\s*<span>Nuclear Pasta/,'delivered rows say which rate they follow');
 assert.match(html,/data-rate-group="other"[^>]*>\s*<span>Screws/,'everything else follows the general rate');

 // A stand-in for the rendered list: one row per group, plus the two rate fields.
 const rows=[['build',{placeholder:'30'}],['delivered',{placeholder:'0'}],['other',{placeholder:'1'}]].map(([group,input])=>({dataset:{rateGroup:group},querySelector:()=>input,input}));
 const fields={storageRate:{value:'1'},buildRate:{value:'30'}};
 c.document.querySelectorAll=sel=>sel==='.rate-row'?rows:[];
 c.document.querySelector=sel=>fields[sel.replace('[name=','').replace(']','')]||null;

 fields.buildRate.value='45';
 vm.runInContext('refreshRatePlaceholders()',c);
 assert.equal(rows[0].input.placeholder,'45','construction boxes follow the construction rate');
 assert.equal(rows[2].input.placeholder,'1','the general boxes are untouched');
 assert.equal(rows[1].input.placeholder,'0','delivered parts stay at zero');

 fields.storageRate.value='4';
 vm.runInContext('refreshRatePlaceholders()',c);
 assert.equal(rows[2].input.placeholder,'4','the general boxes follow the general rate');
 assert.equal(rows[0].input.placeholder,'45','the construction boxes keep their own rate');

 fields.buildRate.value='';
 vm.runInContext('refreshRatePlaceholders()',c);
 assert.equal(rows[0].input.placeholder,'4','an empty construction rate falls back to the general rate, as the planner does');
 fields.storageRate.value='';
 vm.runInContext('refreshRatePlaceholders()',c);
 assert.equal(rows[2].input.placeholder,'4','a half-typed rate leaves the last usable placeholder in place');
});

test('the wizard chooses what the target time applies to and Review shows what a phase used to take',()=>{
 const c=ui();
 vm.runInContext(`wizard={step:3,saveName:'World',name:'Balanced',settings:{...structuredClone(generated.settings),goal:'timed',hours:10},preview:null};`,c);
 const goals=vm.runInContext('renderWizard()',c);
 assert.match(goals,/name="phaseTime"/,'the goals step asks what the target time applies to');
 assert.match(goals,/value="every" selected/,'every phase is the default');
 vm.runInContext(`wizard.settings.phaseTime='final';`,c);
 assert.match(vm.runInContext('renderWizard()',c),/value="final" selected/,'the saved choice is shown');
 assert.match(vm.runInContext(`help('phaseTime')`,c),/final phase/,'the choice is explained');

 vm.runInContext(`wizard.step=5;wizard.preview={...generated,stages:{...generated.stages,1:{...generated.stages[1],hours:5.21,aheadOf:9.92}}};`,c);
 const review=vm.runInContext('renderWizard()',c);
 assert.match(review,/was 9.92 h/,'a pulled-forward phase shows what it used to take');
 vm.runInContext(`wizard.preview=generated;`,c);
 assert.ok(!vm.runInContext('renderWizard()',c).includes('was '),'an ordinary plan shows no such note');

 const form={querySelector:()=>null,reportValidity:()=>true};
 c.FormData=class{*[Symbol.iterator](){yield ['phaseTime','final'];yield ['goal','timed'];}has(){return false;}getAll(){return [];}get(){return null;}};
 vm.runInContext('readWizard(form)',Object.assign(c,{form}));
 assert.equal(vm.runInContext('wizard.settings.phaseTime',c),'final','the choice is carried out of the form');
});
