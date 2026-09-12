import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {progression} from '../public/progression.js';
import {calculate,catalog} from '../planner.mjs';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'').replace(/\nboot\(\);\s*$/,'');
function ui(){const node={addEventListener(){},close(){},showModal(){},innerHTML:''};const c=vm.createContext({document:{querySelector:()=>node,querySelectorAll:()=>[],addEventListener(){},activeElement:null},window:{addEventListener(){},scrollTo(){}},location:{hash:'#plan'},console,setTimeout,clearTimeout,URL,JSON,structuredClone,progression});vm.runInContext(source,c);c.fixture=JSON.parse(fs.readFileSync(new URL('../public/plan.json',import.meta.url),'utf8'));c.catalogData=catalog();c.progressionFixture=JSON.parse(fs.readFileSync(new URL('../public/progression.json',import.meta.url),'utf8'));c.generated=calculate({});vm.runInContext(`plan=fixture;progressionData=progressionFixture;workspace={user:{id:'owner',username:'Pioneer'},accountsEnabled:false,catalog:catalogData,saves:[]};currentSave={id:'s',name:'World <one>'};currentProfile={id:'original',kind:'original',name:'Original'};state={settings:{phase:'3'},checks:{},notes:{},deliveries:{},customTasks:[]};`,c);return c;}
test('original and calculated views render; wizard exposes all settings and safe names',()=>{
 const c=ui();for(const route of ['renderPlan','renderFactories','renderStorage','renderResources','renderBackup','renderProfiles','renderAccount'])assert.ok(vm.runInContext(route+'()',c).length>100,route);
 vm.runInContext(`calculated=generated;currentProfile={id:'p',kind:'calculated',name:'Balanced'};wizard={step:1,saveName:'World <one>',name:'Balanced',settings:structuredClone(generated.settings),preview:generated};`,c);
 for(let step=1;step<=5;step++){const text=vm.runInContext(`wizard.step=${step};renderWizard()`,c);assert.ok(text.includes('wizard-form'));assert.ok(!text.includes('value="World <one>"'));}
 assert.match(vm.runInContext('wizard.step=4;renderWizard()',c),/limitsConfirmed/);
 for(const route of ['renderCalculatedPlan','renderCalculatedFactories','renderCalculatedResources','renderCalculatedBackup','renderStorage'])assert.ok(vm.runInContext(route+'()',c).length>100,route);
 assert.ok(!vm.runInContext('renderStorage()',c).includes('<b>Ground floor is built.</b>'));
 vm.runInContext(`state.settings.phase='1'`,c);assert.ok(vm.runInContext('renderCalculatedPlan()',c).includes('Phase 1'));
});

