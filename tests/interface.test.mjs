import {droneFuels,storageOptions,distributions,purities,powerOptions,resourceDefaults,helpText} from '../public/preferences.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {progression} from '../public/progression.js';
import {calculate,catalog} from '../planner.mjs';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^(?:import[^\n]*\n)+/,'').replaceAll('import.meta.url',JSON.stringify('https://example.com/satisfactory-planner/app.js')).replace(/\nboot\(\);\s*$/,'');
function ui(){const node={addEventListener(){},close(){},showModal(){},innerHTML:''};const c=vm.createContext({document:{querySelector:()=>node,querySelectorAll:()=>[],addEventListener(){},activeElement:null},window:{addEventListener(){},scrollTo(){}},location:{hash:'#plan'},console,setTimeout,clearTimeout,URL,JSON,structuredClone,browserMode:false,progression,droneFuels,storageOptions,distributions,purities,powerOptions,resourceDefaults,helpText});vm.runInContext(source,c);c.fixture=JSON.parse(fs.readFileSync(new URL('../public/plan.json',import.meta.url),'utf8'));c.catalogData=catalog();c.progressionFixture=JSON.parse(fs.readFileSync(new URL('../public/progression.json',import.meta.url),'utf8'));c.generated=calculate({});vm.runInContext(`plan=fixture;progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World <one>'};currentProfile={id:'original',kind:'original',name:'Original'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};`,c);return c;}
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
 const form={reportValidity:()=>true,querySelector:()=>({textContent:''})};c.document.querySelector=()=>form;
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
