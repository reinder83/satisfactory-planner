import {droneFuels,droneSupply,wantsStorage,storageRateFor,constructionItems,elevatorParts,storageOptions,distributions,purities,powerOptions,resourceDefaults} from './public/preferences.js';
import fs from 'node:fs';
import {solve} from './optimizer.mjs';
export const DATA=JSON.parse(fs.readFileSync(new URL('./recipes.json',import.meta.url)));
export const ENGINE='2.0.0';
const MAM_RECIPES=['Recipe_Alternate_Turbofuel_C','Recipe_Alternate_EnrichedCoal_C'];
// Power preferences other than auto/coal/fuel run turbofuel generators (directly or as the Phase 3 bridge).
export const powerNeedsTurbofuel=mainPower=>!['auto','coal','fuel'].includes(mainPower||'auto');
const ALT_IDS=new Set(DATA.recipes.filter(r=>r.alternate).map(r=>r.id));
export const RAW=['Iron Ore','Copper Ore','Limestone','Coal','Caterium Ore','Raw Quartz','Sulfur','Bauxite','Uranium','SAM','Crude Oil','Nitrogen Gas','Water'];
export const DEFAULT_LIMITS={'Iron Ore':92100,'Copper Ore':36900,Limestone:69300,Coal:42300,'Caterium Ore':15000,'Raw Quartz':13500,Sulfur:10800,Bauxite:12300,Uranium:2100,SAM:10200,'Crude Oil':9900,'Nitrogen Gas':12000,Water:1000000};
export const PURE_LIMITS={'Iron Ore':152400,'Copper Ore':66000,Limestone:112800,Coal:74400,'Caterium Ore':20400,'Raw Quartz':20400,Sulfur:19200,Bauxite:20400,Uranium:6000,SAM:22800,'Crude Oil':18000,'Nitrogen Gas':13500,Water:1000000};
export const DELIVERIES={1:{'Smart Plating':50},2:{'Smart Plating':1000,'Versatile Framework':1000,'Automated Wiring':100},3:{'Versatile Framework':2500,'Modular Engine':500,'Adaptive Control Unit':100},4:{'Assembly Director System':500,'Magnetic Field Generator':500,'Thermal Propulsion Rocket':250,'Nuclear Pasta':100},5:{'Nuclear Pasta':1000,'Biochemical Sculptor':1000,'AI Expansion Server':256,'Ballistic Warp Drive':200}};
const err=message=>{throw Object.assign(new Error(message),{status:400});};
const choice=(v,allowed,fallback)=>v===undefined?fallback:allowed.includes(v)?v:err('Invalid profile option.');
const number=(v,min,max,fallback)=>v===undefined?fallback:Number.isFinite(v)&&v>=min&&v<=max?v:err(`Enter a number from ${min} to ${max}.`);
// Per-item storage rates. Only storable item names are accepted so a stale or
// mistyped entry cannot silently reserve production for nothing.
const storable=name=>!RAW.includes(name)&&!DATA.items[name]?.fluid&&!DATA.items[name]?.radioactive&&(DATA.items[name]?.sink||0)>0;
// Production you already run, entered as a rate. Matching an existing factory
// against the plan's own rows does not work: your Modular Frame line is whatever
// recipe and machine count you happened to build, not the one this solve picks.
// A rate is the thing you can actually read off your own factory.
//
// Its ore and its power are already spent in your world, so — exactly as for
// spare existing power — the resource budgets and the spare-power figure are
// entered net of it. Zero is dropped so an untouched profile stays untouched.
const suppliable=name=>!RAW.includes(name)&&!!DATA.items[name];
const supplyRates=raw=>{
 if(raw===undefined)return {};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))err('Invalid existing production rates.');
 const entries=Object.entries(raw);
 if(entries.length>200)err('Too many existing production rates.');
 const out={};
 for(const [name,rate] of entries){
  if(!suppliable(name))err(`${name} cannot be entered as existing production.`);
  const q=number(rate,0,1000000,0);
  if(q>0)out[name]=q;
 }
 return out;
};
const counts3=raw=>{
 const out={};
 if(raw===undefined)return out;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))err('Invalid node counts.');
 if(Object.keys(raw).length>40)err('Invalid node counts.');
 for(const [name,c] of Object.entries(raw)){
  if(!RAW.includes(name))err(`${name} is not a raw resource.`);
  if(!c||typeof c!=='object'||Array.isArray(c))err('Invalid node counts.');
  const row={impure:number(c.impure,0,10000,0),normal:number(c.normal,0,10000,0),pure:number(c.pure,0,10000,0)};
  if(row.impure||row.normal||row.pure)out[name]=row;
 }
 return out;
};
// How the resource budgets were arrived at: the nodes the world holds, the
// miner they will be worked with, and whatever is already spoken for. Recorded
// so the survey can be reopened; the plan itself still runs on `limits`.
const extractionRecord=raw=>{
 if(raw===undefined||raw===null)return null;
 if(typeof raw!=='object'||Array.isArray(raw))err('Invalid extraction survey.');
 const used={};
 if(raw.used!==undefined){
  if(!raw.used||typeof raw.used!=='object'||Array.isArray(raw.used))err('Invalid committed extraction.');
  for(const [name,v] of Object.entries(raw.used)){
   if(!RAW.includes(name))err(`${name} is not a raw resource.`);
   const q=number(v,0,10000000,0);if(q>0)used[name]=q;
  }
 }
 return {
  mark:raw.mark===undefined?3:[1,2,3].includes(raw.mark)?raw.mark:err('Invalid miner mark.'),
  clock:number(raw.clock,0.01,2.5,2.5),
  nodes:counts3(raw.nodes),wells:counts3(raw.wells),used
 };
};
const rateOverrides=raw=>{
 if(raw===undefined)return {};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))err('Invalid per-item storage rates.');
 const entries=Object.entries(raw);
 if(entries.length>200)err('Too many per-item storage rates.');
 const out={};
 for(const [name,rate] of entries){
  if(!storable(name))err(`${name} cannot be given a storage rate.`);
  out[name]=number(rate,0,300,0);
 }
 return out;
};
// Somersloops parked in hand-fed constructors: slugs to shards, remains to protein and DNA,
// biomass to solid biofuel. Their inputs are gathered, never belted, so these reserve a
// somersloop and add checklist steps without entering the continuous production balance.
export const SLOOP_USES=[['shards','Power Shards from power slugs'],['dna','Alien Protein and DNA Capsules from remains'],['biofuel','Solid Biofuel from biomass']];
const reservedUses=raw=>{
 if(raw===undefined)return [];
 if(!Array.isArray(raw))err('Invalid somersloop reservations.');
 return [...new Set(raw.filter(x=>SLOOP_USES.some(([id])=>id===x)))].sort();
};
export function settings(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))err('Invalid settings.');
 const s={utilityPercent:number(input.utilityPercent,0,200,20),droneFuel:choice(input.droneFuel,droneFuels,'none'),droneFuelRate:number(input.droneFuelRate,0.01,10000,10),droneBridgeRate:number(input.droneBridgeRate,0.01,10000,10),worldSeed:input.worldSeed===undefined||input.worldSeed===''?'':String(number(Number(input.worldSeed),-2147483648,2147483647,1)),mainPower:choice(input.mainPower,powerOptions.map(x=>x[0]),'auto'),collectables:input.collectables===true,phase:choice(String(input.phase||'3'),['1','2','3','4','5'],'3'),purity:choice(input.purity,purities.map(x=>x[0]),'vanilla'),distribution:choice(input.distribution,distributions.map(x=>x[0]),'original'),multiplier:number(input.multiplier,0.1,1000,1),powerFactor:number(input.powerFactor,0,10,1),availablePowerGW:number(input.availablePowerGW,0,10000,0),recipes:choice(input.recipes,['standard','all','custom'],'standard'),pureIngots:!!input.pureIngots,sam:choice(input.sam,['avoid','needed','allow'],'needed'),nuclear:choice(input.nuclear,['none','sink','recycle'],'none'),uraniumReactors:number(input.uraniumReactors,1,1000,1),storage:choice(input.storage,storageOptions.map(x=>x[0]),'construction'),storageRate:number(input.storageRate,0.1,300,1),buildRate:number(input.buildRate,0,300,number(input.storageRate,0.1,300,1)),storageOverrides:rateOverrides(input.storageOverrides),existingSupply:supplyRates(input.existingSupply),extraction:extractionRecord(input.extraction),cellsPerMinute:number(input.cellsPerMinute,0,1000,0),installedPowerGW:number(input.installedPowerGW,0,10000,number(input.availablePowerGW,0,10000,0)),somersloops:number(input.somersloops,0,106,0),augmenters:number(input.augmenters,0,10,0),fueledAugmenters:number(input.fueledAugmenters,0,10,0),sloopReserved:reservedUses(input.sloopReserved),amplifySloops:number(input.amplifySloops,0,106,0),goal:choice(input.goal,['minimal','balanced','timed','maximum'],'balanced'),phaseTime:choice(input.phaseTime,['every','final'],'every'),hours:number(input.hours,0.25,2000,8),roundRates:input.roundRates!==false,wholeMachines:input.wholeMachines===true,limitsConfirmed:!!input.limitsConfirmed,modNotes:typeof input.modNotes==='string'?input.modNotes.slice(0,500):''};
 if(s.droneFuel==='Plutonium Fuel Rod'&&s.nuclear==='none')err('Plutonium drone fuel requires a nuclear power and waste-processing strategy.');
 if(s.fueledAugmenters>s.augmenters)err('More fueled Alien Power Augmenters than augmenters.');
 if(s.installedPowerGW<s.availablePowerGW)err('Total installed generation cannot be less than the spare part of it.');
 s.limits={};const defaults=resourceDefaults(s.purity,s.distribution).limits;
 if((s.mainPower==='nuclear'||s.mainPower.endsWith('-nuclear'))&&s.nuclear==='none')err('Choose a nuclear waste strategy for a nuclear power preference.');
 for(const r of RAW)s.limits[r]=number(input.limits?.[r],0,10000000,defaults[r]);
 s.alternateRecipes=Array.isArray(input.alternateRecipes)?[...new Set(input.alternateRecipes.filter(x=>ALT_IDS.has(x)))].sort():[];
 if(s.recipes==='custom'&&powerNeedsTurbofuel(s.mainPower))s.alternateRecipes=[...new Set([...s.alternateRecipes,...MAM_RECIPES])].sort();
 s.preferredRecipes=Array.isArray(input.preferredRecipes)?[...new Set(input.preferredRecipes.filter(x=>s.alternateRecipes.includes(x)))].sort():[];
 return s;
}
const pureNames=['Alternate: Pure Iron Ingot','Alternate: Pure Copper Ingot','Alternate: Pure Caterium Ingot','Alternate: Pure Aluminum Ingot'];
const metals=['Iron Ingot','Copper Ingot','Caterium Ingot','Aluminum Ingot'];
const key=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function recipePool(s,phase,conversion){
 return DATA.recipes.filter(r=>!MAM_RECIPES.includes(r.id)||s.recipes!=='custom'||s.alternateRecipes.includes(r.id)).map(r=>MAM_RECIPES.includes(r.id)?{...r,alternate:false,name:r.name.replace('Alternate: ','')}:r).filter(r=>r.phase<=phase&&(s.recipes==='all'||!r.alternate||s.recipes==='custom'&&s.alternateRecipes.includes(r.id)||s.pureIngots&&pureNames.includes(r.name)))
 .filter(r=>!(s.pureIngots&&phase>=3&&metals.some(n=>r.outputs[n])&&!pureNames.includes(r.name)))
 .filter(r=>!Object.keys(r.outputs).some(x=>RAW.includes(x)&&x!=='Water')||conversion)
 .filter(r=>!['Uranium Fuel Rod','Plutonium Fuel Rod','Ficsonium','Ficsonium Fuel Rod','Encased Uranium Cell','Non-Fissile Uranium','Plutonium Pellet','Encased Plutonium Cell'].some(x=>r.outputs[x])||s.nuclear!=='none'||phase>=4&&s.droneFuel==='Uranium Fuel Rod'&&['Uranium Fuel Rod','Encased Uranium Cell'].some(x=>r.outputs[x]))
 .filter(r=>{ // a preferred recipe replaces competing recipes for its primary product at phases where it is available
  const preferred=s.recipes==='custom'?s.preferredRecipes||[]:[];
  if(!preferred.length||preferred.includes(r.id))return true;
  return !preferred.some(id=>{const p=DATA.recipes.find(x=>x.id===id);return p&&p.phase<=phase&&Object.keys(p.outputs)[0]===Object.keys(r.outputs)[0];});
 });
}
// Production amplification. A somersloop machine is a whole machine: the same inputs, double the
// output and four times the power, per (1 + filled/total)^2 with every slot filled. Miners,
// extractors, packagers and generators have no slots. Opt-in: with no budget nothing is offered,
// so a plan that does not want to go slug hunting is calculated exactly as before.
// How many of the largest lines are offered an amplified twin. Every twin is another integer
// variable, and the fit has to finish inside the solver's time limit: whole-machine plans already
// carry integer machine counts, so they can afford fewer twins than precisely balanced ones.
// Measured against the heaviest plans in the test set; raising these starts losing whole phases.
export const AMPLIFY_CANDIDATES={whole:22,precise:26};
export const AMPLIFY_SLOTS={Smelter:1,Constructor:1,Assembler:2,Foundry:2,Refinery:2,Converter:2,Manufacturer:4,Blender:4,'Particle Accelerator':4,'Quantum Encoder':4};
const amplifiable=r=>r.power>0&&AMPLIFY_SLOTS[r.machine]>0;
const amplified=r=>({...r,id:'amp:'+r.id,name:r.name+' (somersloop amplified)',power:r.power*4,slots:AMPLIFY_SLOTS[r.machine],outputs:Object.fromEntries(Object.entries(r.outputs).map(([n,q])=>[n,q*2]))});
function generators(s,phase){
 const result=[];
 if(phase>=2)result.push({id:'power-coal',name:'Coal power',machine:'Coal Generator',phase:2,power:-75,inputs:{Coal:15,Water:45},outputs:{}});
 if(phase>=3)for(const name of ['Fuel','Turbofuel',...(phase>=4?['Rocket Fuel']:[])])result.push({id:'power-'+key(name),name:name+' power',machine:'Fuel Generator',phase:3,power:-250,inputs:{[name]:15000/DATA.items[name].energy},outputs:{}});
 if(phase>=4&&s.nuclear!=='none'){
  result.push({id:'power-uranium',name:'Uranium power',machine:'Nuclear Power Plant',phase:4,power:-2500,inputs:{'Uranium Fuel Rod':0.2,Water:240},outputs:{'Uranium Waste':10}});
  if(phase===5&&s.nuclear==='recycle')result.push({id:'power-plutonium',name:'Plutonium power',machine:'Nuclear Power Plant',phase:5,power:-2500,inputs:{'Plutonium Fuel Rod':0.1,Water:240},outputs:{'Plutonium Waste':1}},{id:'power-ficsonium',name:'Ficsonium power',machine:'Nuclear Power Plant',phase:5,power:-2500,inputs:{'Ficsonium Fuel Rod':1,Water:240},outputs:{}});
 }
 const preferred=s.mainPower||'auto';
 if(preferred==='auto'||phase<3)return result;
 if(preferred==='coal')return result.filter(r=>r.id==='power-coal'||r.machine==='Nuclear Power Plant');
 if(preferred==='nuclear'&&phase>=4)return result.filter(r=>r.machine==='Nuclear Power Plant');
 const fuel=preferred==='fuel'?'Fuel':preferred.startsWith('rocket')&&phase>=4?'Rocket Fuel':'Turbofuel';
 return result.filter(r=>r.machine==='Nuclear Power Plant'||r.inputs[fuel]);
}
export function run(s,phase,{maximum=false,conversion=false,ignoreLimits=false,recipeIds=null,caps=null,baseline=null}={}){
 if((s.wholeMachines||s.amplifySloops>0)&&!recipeIds){
  const opts={maximum,conversion,ignoreLimits,caps};
  const exact=t=>run({...t,wholeMachines:false,amplifySloops:0},phase,opts);
  const twins=b=>Object.fromEntries([...b.rows].filter(r=>r.equivalent>=1).sort((x,y)=>y.equivalent-x.equivalent).slice(0,AMPLIFY_CANDIDATES[s.wholeMachines?'whole':'precise']).map(r=>[r.id,r.equivalent]));
  const base=exact(s);if(!base.feasible)return base;
  const ids=new Set(base.rows.map(r=>r.id));
  const baseline=twins(base);
  let fit=run(s,phase,{...opts,recipeIds:ids,baseline});
  // Crediting production you already run narrows the recipe network the exact solve picks, and a
  // narrower network has less room to round up to whole machines. Widen it with the recipes this
  // phase would have used without the credit before concluding anything — the supplied plan is
  // still the smaller one, it just needs the slack. If even that will not round, drop the credit:
  // telling the planner what you already built must never cost you a plan, the same rule
  // amplification follows below.
  if(!fit.feasible&&Object.keys(s.existingSupply).length){
   const plainBase=exact({...s,existingSupply:{}});
   if(plainBase.feasible){
    const plainIds=new Set(plainBase.rows.map(r=>r.id));
    const widened=run(s,phase,{...opts,recipeIds:new Set([...ids,...plainIds]),baseline});
    if(widened.feasible)fit=widened;
    else{const without=run({...s,existingSupply:{}},phase,{...opts,recipeIds:plainIds,baseline:twins(plainBase)});if(without.feasible)return {...without,supplyDropped:true};}
   }
  }
  // Amplification is optional by definition: the solver may always place no somersloops at all.
  // So a failure here is the integer search running out of time, never a real shortage — never let
  // it cost the user a plan that fits. Fall back to the unamplified fit and say so.
  if(!fit.feasible&&s.amplifySloops>0){const plain=run({...s,amplifySloops:0},phase,{...opts,recipeIds:ids});if(plain.feasible)return {...plain,amplificationDropped:true};}
  return fit;
 }
 const selected=[...recipePool(s,phase,conversion),...generators(s,phase)].filter(r=>!recipeIds||recipeIds.has(r.id)||conversion&&Object.keys(r.outputs).some(n=>RAW.includes(n)&&n!=='Water'));
 const pool=[...selected,...(s.amplifySloops>0&&recipeIds?selected.filter(r=>amplifiable(r)&&baseline?.[r.id]!==undefined).map(amplified):[])];
 const reachable=new Set(RAW);if(s.nuclear!=='none'&&phase>=4)reachable.add('Uranium Waste');if(s.nuclear==='recycle'&&phase===5)reachable.add('Plutonium Waste');
 for(let i=0;i<20;i++)for(const r of pool)if(Object.keys(r.inputs).every(n=>reachable.has(n)))Object.keys(r.outputs).forEach(n=>reachable.add(n));
 const allItems=new Set(pool.flatMap(r=>[...Object.keys(r.inputs),...Object.keys(r.outputs)]));
 const demand={};const storage={};const drone=droneSupply(s,phase),utilityFactor=1+(s.utilityPercent??20)/100;
 const candidates=[...reachable].filter(n=>!RAW.includes(n)&&!DATA.items[n]?.fluid&&!DATA.items[n]?.radioactive&&(DATA.items[n]?.sink||0)>0&&wantsStorage(n,s.storage));
 for(const n of candidates)if(reachable.has(n)){const rate=storageRateFor(s,n);storage[n]=rate;if(rate>0)demand[n]=rate;}
 const delivery={};const hours=s.goal==='minimal'?24:s.goal==='balanced'?8:s.hours;
 for(const [n,amount] of Object.entries(DELIVERIES[phase])){let rate=amount*s.multiplier/(hours*60);if(s.roundRates)rate=rate>=100?Math.round(rate/10)*10:rate>=10?Math.round(rate):Math.ceil(rate*10)/10;delivery[n]={target:Math.ceil(amount*s.multiplier),rate};if(!maximum)demand[n]=(demand[n]||0)+rate;}
 for(const [n,q] of Object.entries(drone))demand[n]=(demand[n]||0)+q;
 if(phase===5&&s.cellsPerMinute)demand['Singularity Cell']=(demand['Singularity Cell']||0)+s.cellsPerMinute;
 // Each fueled augmenter needs 5 Alien Power Matrix/min. The rate is derived from the augmenter
 // count rather than entered, so the fuel line can never disagree with the augmenters it feeds.
 const matrix=phase===5?5*s.fueledAugmenters:0;if(matrix)demand['Alien Power Matrix']=(demand['Alien Power Matrix']||0)+matrix;
 Object.keys(demand).forEach(n=>allItems.add(n));
 const model={optimize:maximum?'gain':'cost',opType:maximum?'max':'min',constraints:{},variables:{}};
 // An item the AWESOME Sink cannot accept has nowhere to overflow: Power Shards would back a
 // Synthetic Power Shard line up and stall it. Balance those exactly, as fluids and waste are.
 for(const n of allItems){const equality=DATA.items[n]?.fluid||DATA.items[n]?.radioactive||n.endsWith('Waste')||!(DATA.items[n]?.sink>0);model.constraints['item:'+n]=equality?{equal:demand[n]||0}:{min:demand[n]||0};}
 // A 20% planning allowance covers unmodelled mining, pumps and logistics; existing power is spare capacity.
 // Alien Power Augmenters generate 500 MW each and multiply the grid's base production:
 // (generators + 500 x augmenters) x (1 + 0.1 x unfueled + 0.3 x fueled). The multiplier applies to
 // installed capacity, of which the entered spare power is only a part, so both are needed here.
 const augmenters=phase===5?s.augmenters:0,fueled=phase===5?s.fueledAugmenters:0;
 const boost=0.1*(augmenters-fueled)+0.3*fueled,installedMW=s.installedPowerGW*1000;
 const spareMW=s.availablePowerGW*1000+(installedMW+500*augmenters)*(1+boost)-installedMW;
 if(phase>=2||maximum)model.constraints.power={max:spareMW};
 for(const r of pool){
  const v={cost:1+(r.power>0?r.power/100000:0),power:r.power<0?r.power*(1+boost):r.power*s.powerFactor*utilityFactor};
  for(const [n,q] of Object.entries(r.outputs))v['item:'+n]=(v['item:'+n]||0)+q;
  for(const [n,q] of Object.entries(r.inputs))v['item:'+n]=(v['item:'+n]||0)-q;
  if(r.id==='power-uranium'){v.nuclear=1;model.constraints.nuclear={min:s.uraniumReactors};}
  model.variables[r.id]=v;
  if(r.slots){
   (model.ints??={})[r.id]=1;v.sloops=r.slots;
   // One amplified machine does the work of two, so a line never wants more than half its
   // unamplified count, and the whole budget cannot buy more than it can pay slots for.
   const need=baseline?.[r.id.slice(4)];
   (model.bounds??={})[r.id]=Math.max(1,Math.min(Math.floor(s.amplifySloops/r.slots),need===undefined?1e9:Math.ceil(need/2)+1));
  }
  if(s.wholeMachines&&Object.keys(r.outputs).some(n=>!DATA.items[n]?.fluid&&!RAW.includes(n)&&DATA.items[n]?.sink>0)&&!/uranium|plutonium|ficsonium|waste|non-fissile/i.test([r.name,...Object.keys(r.inputs),...Object.keys(r.outputs)].join(' '))){(model.ints??={})[r.id]=1;}
 }
 // An earlier phase may run no more of a recipe than a later phase already builds, so nothing is added that the plan later drops.
 if(s.amplifySloops>0)model.constraints.sloops={max:s.amplifySloops};
 if(caps)for(const r of pool){const cap=caps[r.id]??0;model.constraints["cap:"+r.id]={max:cap};model.variables[r.id]["cap:"+r.id]=1;}
 // Diagnostics use the highest budget the settings accept; larger bounds destabilize the WASM MIP solver.
 for(const n of RAW){if(!allItems.has(n))continue;model.constraints['limit:'+n]={max:ignoreLimits?1e7:s.limits[n]};model.variables['raw:'+n]={cost:0.0001,['item:'+n]:1,['limit:'+n]:1};}
 // A line you already run is a capped, almost-free source of its product, so the
 // plan builds only the remainder and drops the whole chain behind what you
 // already make. Almost free rather than free: the solver still prefers not to
 // draw supply it has no use for. An item this phase neither makes nor consumes
 // is skipped, because crediting it would mean nothing.
 for(const [n,rate] of Object.entries(s.existingSupply)){
  if(!allItems.has(n))continue;
  model.constraints['supply:'+n]={max:rate};
  model.variables['supply:'+n]={cost:0.0001,['item:'+n]:1,['supply:'+n]:1};
 }
 if(s.nuclear!=='none'&&phase>=4&&(s.nuclear==='sink'||phase===4))model.variables['sink-plutonium']={cost:0.0001,'item:Plutonium Fuel Rod':-1};
 if(maximum){const v={gain:1};for(const [n,d] of Object.entries(delivery))v['item:'+n]=-d.target/1000;model.variables.goal=v;}
 let solved=solve(model);
 if(maximum&&solved.feasible){model.constraints.keepGoal={min:solved.goal*(1-1e-8)};model.variables.goal.keepGoal=1;model.optimize="cost";model.opType="min";const economical=solve(model);if(economical.feasible)solved=economical;}if(!solved.feasible||!solved.bounded)return {feasible:false,solverStatus:solved.solverStatus};
 // Independently verify material, power and mining constraints before trusting a result.
 for(const [k,b] of Object.entries(model.constraints)){
  let total=0;for(const [v,co] of Object.entries(model.variables))total+=(solved[v]||0)*(co[k]||0);
  const tol=0.002+Math.abs(total)*1e-6;if(b.min!==undefined&&total<b.min-tol||b.max!==undefined&&total>b.max+tol||b.equal!==undefined&&Math.abs(total-b.equal)>tol)return {feasible:false};
 }
 if(maximum)for(const d of Object.values(delivery))d.rate=(solved.goal||0)*d.target/1000;
 const rows=pool.filter(r=>(solved[r.id]||0)>1e-6).map(r=>{const eq=solved[r.id];const machines=Math.ceil(eq-1e-6);return {...r,equivalent:eq,machines,...(r.slots?{amplified:true,sloops:r.slots*machines}:{}),lastClock:Math.max(0,(eq-machines+1)*100),inputs:Object.fromEntries(Object.entries(r.inputs).map(([n,q])=>[n,q*eq])),outputs:Object.fromEntries(Object.entries(r.outputs).map(([n,q])=>[n,q*eq])),peakMW:r.power<0?0:machines*r.power*s.powerFactor,generationMW:r.power<0?-r.power*eq:0};});
 const supplied=Object.fromEntries(Object.entries(s.existingSupply).map(([n])=>[n,solved['supply:'+n]||0]).filter(([,q])=>q>0.002));
 const raw=Object.fromEntries(RAW.map(n=>[n,solved['raw:'+n]||0]));const used={},made={};for(const r of rows){for(const [n,q] of Object.entries(r.inputs))used[n]=(used[n]||0)+q;for(const [n,q] of Object.entries(r.outputs))made[n]=(made[n]||0)+q;}
 const surplus=Object.fromEntries(Object.keys(made).map(n=>[n,Math.max(0,made[n]-(used[n]||0)-(storage[n]||0)-(delivery[n]?.rate||0)-(drone[n]||0)-(n==='Singularity Cell'&&phase===5?s.cellsPerMinute:0)-(n==='Alien Power Matrix'?matrix:0))]).filter(([n,q])=>q>0.002&&!DATA.items[n]?.radioactive&&!DATA.items[n]?.fluid&&DATA.items[n]?.sink>0));
 const peakMW=rows.reduce((a,r)=>a+r.peakMW,0),generationMW=rows.reduce((a,r)=>a+r.generationMW,0);
 // Order by dependency depth; recycling loops are commissioned as a connected group.
 const producers={};for(const r of rows)for(const n of Object.keys(r.outputs))(producers[n]??=[]).push(r);
 const seen=new Set(),visiting=new Set(),ordered=[];function visit(r){if(seen.has(r.id)||visiting.has(r.id))return;visiting.add(r.id);for(const n of Object.keys(r.inputs))for(const p of producers[n]||[])visit(p);visiting.delete(r.id);seen.add(r.id);ordered.push(r);}rows.forEach(visit);
 return {feasible:true,rows:ordered,raw,supplied,storage,drone,delivery,surplus,plutoniumSink:solved['sink-plutonium']||0,peakMW,generationMW,sloopsUsed:rows.reduce((a,r)=>a+(r.sloops||0),0),augmenters,fueledAugmenters:fueled,boost,augmenterMW:500*augmenters,matrixRate:matrix,availableMW:generationMW*(1+boost)+spareMW,requiredMW:peakMW*utilityFactor,additionalHeadroomMW:Math.max(0,peakMW*utilityFactor-generationMW*(1+boost)-spareMW),hours:Math.max(...Object.values(delivery).map(d=>d.rate?d.target/d.rate/60:Infinity)),conversions:rows.filter(r=>Object.keys(r.outputs).some(n=>RAW.includes(n)&&n!=='Water')).map(r=>r.name)};
}
export function calculate(input,onPhase){
 const s=settings(input);if(s.goal==='maximum'&&!s.limitsConfirmed)err('Confirm your available resource budgets before maximizing output.');
 const stages={};const warnings=[];
 for(let phase=1;phase<=5;phase++){
  onPhase?.(phase);
  let result=run(s,phase,{maximum:s.goal==='maximum',conversion:phase===5&&s.sam==='allow'});
  if(!result.feasible&&phase===5&&s.sam==='needed')result=run(s,phase,{maximum:s.goal==='maximum',conversion:true});
  // For maximum output, compare conversion when allowed only at a binding resource limit.
  if(s.goal==='maximum'&&phase===5&&s.sam==='needed'){const converted=run(s,phase,{maximum:true,conversion:true});if(converted.feasible&&(!result.feasible||converted.hours<result.hours-1e-6))result=converted;}
  // The draft only explains what exceeds the budgets: the exact LP is fast and avoids another integer search.
  if(!result.feasible){
   const conversion=phase===5&&s.sam!=='avoid';
   const diagnostic=run({...s,wholeMachines:false},phase,{conversion,ignoreLimits:true});
   const stage={...diagnostic,feasible:false};
   if(result.solverStatus&&!/infeasible/i.test(result.solverStatus))stage.reason='The whole-machine solver could not finish this combination within its time limit. Try fewer alternates or precise balancing; no resource shortage has been established.';
   else if(!diagnostic.feasible)stage.reason='The selected recipe/power options cannot support this combination. Allow alternates or change the goals.';
   else{
    const fits=h=>run({...s,wholeMachines:false,goal:'timed',hours:h},phase,{conversion}).feasible;
    const currentHours=s.goal==='minimal'?24:s.goal==='balanced'?8:s.hours;
    const listNames=a=>a.length>1?a.slice(0,-1).join(', ')+' and '+a[a.length-1]:a[0];
    if(s.goal!=='maximum'&&fits(currentHours)){
     // Only rounding up to whole machines breaks a budget here. Re-fit the same recipe network with
     // doubled budgets to measure which resources need headroom and how much; keep bounds modest for MIP stability.
     stage.wholeMachinesOnly=true;
     const network=run({...s,wholeMachines:false},phase,{conversion});
     const rounded=network.feasible?run({...s,limits:Object.fromEntries(RAW.map(n=>[n,s.limits[n]*2+600]))},phase,{conversion,recipeIds:new Set(network.rows.map(r=>r.id))}):{feasible:false};
     if(rounded.feasible)stage.shortfalls=RAW.filter(n=>(rounded.raw[n]||0)>s.limits[n]+0.001).map(n=>({name:n,needed:Math.ceil(rounded.raw[n]),budget:s.limits[n]}));
     const names=(stage.shortfalls||[]).map(x=>x.name);
     stage.reason=names.length
      ?`Precise balancing fits these budgets, but whole solid-part machines at 100% need more ${listNames(names)}. Raise ${names.length>1?'those budgets':'that budget'} a little, or turn off whole-machine production for this profile.`
      :'Mixed-recipe balancing fits these budgets, but running solid-part machines whole at 100% does not. Add some budget headroom or turn off whole-machine production for this profile.';
    }
    else{
     stage.shortfalls=RAW.filter(n=>(diagnostic.raw[n]||0)>s.limits[n]+0.05).map(n=>({name:n,needed:Math.ceil(diagnostic.raw[n]),budget:s.limits[n]}));
     // The minimal per-phase time is found on the exact LP; whole machines may need slightly more.
     if(s.goal!=='maximum'&&fits(2000)){let lo=currentHours,hi=2000;for(let i=0;i<12&&hi-lo>0.25;i++){const mid=(lo+hi)/2;if(fits(mid))hi=mid;else lo=mid;}stage.minHours=Math.ceil(hi*4)/4;}
     const names=stage.shortfalls.map(x=>x.name);
     stage.reason=(names.length?`This phase needs more ${listNames(names)} than the entered budgets provide.`:'The goal exceeds the available resource or power budgets.')
      +(stage.minHours?` It fits the current budgets at about ${stage.minHours} hours for this phase.`:s.goal==='maximum'?' Raise those budgets, or reduce the protected storage, drone-fuel and Singularity Cell demands.':' More time alone will not fit: continuous demands (protected storage, drone fuel, cells and minimum rounded delivery rates) already exceed the budgets.');
    }
   }
   stages[phase]=stage;
  }
  else stages[phase]=result;
 }
 // With the target time on the final phase, an earlier phase may run its lines as
 // hard as the machines a later phase already builds allow, so it finishes sooner
 // without adding a building the plan later drops. A phase is never made slower,
 // and nothing is pulled forward past what its own phase can unlock and power.
 if(s.phaseTime==='final'&&s.goal!=='maximum'&&Object.values(stages).every(x=>x.feasible)){
  const built={};
  for(let phase=1;phase<=5;phase++)for(const r of stages[phase].rows||[])built[phase]={...built[phase],[r.id]:r.machines};
  for(let phase=1;phase<=4;phase++){
   const caps={};for(let later=phase;later<=5;later++)for(const [id,machines] of Object.entries(built[later]||{}))caps[id]=Math.max(caps[id]||0,machines);
   const ahead=run(s,phase,{maximum:true,caps});
   if(ahead.feasible&&ahead.hours<stages[phase].hours-1e-6)stages[phase]={...ahead,aheadOf:stages[phase].hours};
  }
  const pulled=Object.values(stages).filter(x=>x.aheadOf!==undefined).length;
  warnings.push(pulled
   ?`Your target time applies to Phase 5. Earlier phases run their lines as hard as the machines a later phase already builds allow, so ${pulled===1?'one phase finishes':pulled+' phases finish'} sooner; no building is added that a later phase does not keep. Delivery rates for those phases are not rounded.`
   :'Your target time applies to Phase 5. No earlier phase could finish sooner within the machines its later phases already build.');
 }
 // Fueling an augmenter buys 20% more grid power in exchange for an Alien Power Matrix line.
 // Whether that pays depends on the plan's own scale, so solve Phase 5 again without the fuel
 // and compare like for like: same goal, same budgets, same recipes.
 if(s.fueledAugmenters&&stages[5]?.feasible){
  const dry=(()=>{const opts={maximum:s.goal==='maximum'};let r=run({...s,fueledAugmenters:0},5,{...opts,conversion:s.sam==='allow'});if(!r.feasible&&s.sam!=='avoid')r=run({...s,fueledAugmenters:0},5,{...opts,conversion:true});return r;})();
  const count=x=>(x.rows||[]).reduce((a,r)=>a+r.machines,0),wet=stages[5];
  stages[5]={...wet,fuelVerdict:{
   unfueledFeasible:!!dry.feasible,
   buildings:count(wet),buildingsUnfueled:dry.feasible?count(dry):null,
   requiredMW:wet.requiredMW,requiredMWUnfueled:dry.feasible?dry.requiredMW:null,
   availableMW:wet.availableMW,availableMWUnfueled:dry.feasible?dry.availableMW:null,
   hours:wet.hours,hoursUnfueled:dry.feasible?dry.hours:null,matrixRate:wet.matrixRate,
   worthIt:!dry.feasible||(s.goal==='maximum'?wet.hours<dry.hours-1e-6:count(wet)<count(dry))
  }};
 }
 if(s.augmenters||s.amplifySloops){
  const committed=10*s.augmenters+s.sloopReserved.length+s.amplifySloops;
  if(s.augmenters)warnings.push(`${s.augmenters} Alien Power Augmenter${s.augmenters>1?'s':''}: ${500*s.augmenters} MW of generation, plus a ${Math.round((0.1*(s.augmenters-s.fueledAugmenters)+0.3*s.fueledAugmenters)*100)}% multiplier on the Phase 5 grid's base production. That multiplier applies to installed capacity, so it is calculated from the total installed generation in your settings, not from the spare part of it. Augmenters are Phase 5 buildings; earlier phases are planned without them.`);
  if(s.somersloops&&committed>s.somersloops)warnings.push(`This plan commits ${committed} somersloops — 10 per augmenter${s.sloopReserved.length?`, ${s.sloopReserved.length} reserved for hand-fed lines`:''}${s.amplifySloops?`, ${s.amplifySloops} for production amplification`:''} — but ${s.somersloops} are recorded as available. Collect more, or build fewer augmenters.`);
 }
 {
  const used=Math.max(0,...Object.values(stages).map(x=>x.sloopsUsed||0));
  const dropped=Object.entries(stages).filter(([,x])=>x.amplificationDropped).map(([p])=>p);
  if(s.amplifySloops>0)warnings.push(`Production amplification may place up to ${s.amplifySloops} somersloops in each phase's plan, and this plan uses ${used}. Each phase is a self-contained steady state, so that budget is per phase rather than a running total: the somersloops move as you rebuild. Amplified machines are whole machines at 100% — same inputs, double output, four times the power — and the recipe network is chosen before amplification is fitted to it, so the result is not a global optimum over amplified and unamplified recipes together.`);
  if(dropped.length)warnings.push(`Phase ${dropped.join(' and ')} could not fit production amplification within the solver's time limit, so ${dropped.length>1?'those phases are':'that phase is'} planned without it and no somersloops are placed there. A smaller amplification budget usually fits.`);
 }
 {
  const supplied=[...new Set(Object.values(stages).flatMap(x=>Object.keys(x.supplied||{})))].sort();
  const lost=Object.entries(stages).filter(([,x])=>x.supplyDropped).map(([p])=>p);
  if(supplied.length)warnings.push(`This plan draws on production you already run: ${supplied.join(', ')}. Those lines are not planned or built again, and the chain behind them is not planned either. Their ore and their power are already spent in your world, so the resource budgets and the spare-power figure must be entered net of them, exactly as for any other existing factory.`);
  if(lost.length)warnings.push(`Phase ${lost.join(' and ')} could not be fitted to whole machines while crediting the production you already run, so ${lost.length>1?'those phases are':'that phase is'} planned as if you built all of it yourself. Nothing is lost: the plan is simply the larger one. Precise balancing instead of whole machines usually keeps the credit.`);
 }
 if(s.fueledAugmenters)warnings.push(`Fuel for ${s.fueledAugmenters} augmenter${s.fueledAugmenters>1?'s':''} adds ${5*s.fueledAugmenters} Alien Power Matrix/min to Phase 5, with the Quantum Encoder chain behind it. That rate is derived from the augmenter count, never entered separately.`);
 {
  const stuck=[...new Set(Object.values(stages).flatMap(x=>(x.rows||[]).flatMap(r=>Object.keys(r.outputs))).filter(n=>!DATA.items[n]?.fluid&&!DATA.items[n]?.radioactive&&!n.endsWith('Waste')&&!RAW.includes(n)&&!(DATA.items[n]?.sink>0)))];
  if(stuck.length)warnings.push(`${stuck.join(' and ')} cannot be sent to the AWESOME Sink, so ${stuck.length>1?'those lines are':'that line is'} balanced exactly instead of run whole at 100%: the last machine is underclocked and nothing is left over to back the line up.`);
 }
 if(s.distribution!=='original'||s.purity==='custom')warnings.push('Seed-dependent distribution: confirm resource-rich node counts, mixed purity and well totals against your save. Zero budgets mean unallocated resources.');
 if(!s.limitsConfirmed)warnings.push('Resource budgets are provisional. Confirm available extraction after reserving resources for existing factories.');
 warnings.push('Phase targets assume that phase’s milestones and required MAM research are unlocked. Gathered items, buildings and equipment are not continuously automated.');
 warnings.push(`Power includes new generators and their fuel chains, with a ${s.utilityPercent}% allowance for trains, drone ports, mining and pumps. Existing plants are represented only by spare capacity; subtract their fuel from available resources. Drone fuel is a separate protected supply contract, not a route-consumption estimate.`);
 if(s.wholeMachines)warnings.push('Solid-part production uses whole machines at 100%. Surplus goes to storage then the sink. Recipe choices are selected first; the result is not a global mixed-recipe integer optimum. Fluid, power and nuclear balancing can retain fractional clocks.');
 warnings.push('Maximum output optimizes elevator completion within the entered budgets and allowed recipes; it is not an unrestricted global game optimum.');
 if(s.modNotes)warnings.push('Mod notes are recorded only. Changed recipes, output boosts and modded items are not simulated.');
 return {engine:ENGINE,settings:s,stages,warnings,createdAt:new Date().toISOString()};
}
export const catalog=()=>({engine:ENGINE,alternates:DATA.recipes.filter(r=>r.alternate&&r.phase<=5).map(r=>({id:r.id,name:r.name.replace('Alternate: ',''),phase:r.phase,machine:r.machine,inputs:r.inputs,outputs:r.outputs,...(MAM_RECIPES.includes(r.id)?{mam:true}:{}),...(pureNames.includes(r.name)?{pure:true}:{})})).sort((a,b)=>a.name.localeCompare(b.name)),standardRecipes:DATA.recipes.filter(r=>!r.alternate).map(r=>({id:r.id,name:r.name,phase:r.phase,machine:r.machine,inputs:r.inputs,outputs:r.outputs})),storageOptions,supplyItems:[...new Set(DATA.recipes.filter(r=>r.phase<=5).flatMap(r=>Object.keys(r.outputs)))].filter(n=>!RAW.includes(n)&&!!DATA.items[n]).sort((a,b)=>a.localeCompare(b)),storageItems:Object.keys(DATA.items).filter(storable).map(name=>({name,build:constructionItems.includes(name),delivered:elevatorParts.includes(name)})).sort((a,b)=>Number(b.build)-Number(a.build)||a.name.localeCompare(b.name)),distributions,purities,powerOptions,sloopUses:SLOOP_USES,raw:RAW,limits:DEFAULT_LIMITS,pureLimits:PURE_LIMITS,goals:[{id:'minimal',name:'Minimal construction',description:'24-hour deliveries; minimize production-building equivalents.'},{id:'balanced',name:'Balanced progression',description:'8-hour deliveries with the selected storage and recipe preferences.'},{id:'timed',name:'Target completion time',description:'Calculate rates from your chosen hours per phase.'},{id:'maximum',name:'Maximum elevator output',description:'Fastest simultaneous delivery within confirmed resource budgets.'}]});




