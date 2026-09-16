import {droneFuels,droneSupply,wantsStorage,storageOptions,distributions,purities,powerOptions,resourceDefaults} from './public/preferences.js';
import fs from 'node:fs';
import {solve} from './optimizer.mjs';
export const DATA=JSON.parse(fs.readFileSync(new URL('./recipes.json',import.meta.url)));
export const ENGINE='2.0.0';
const MAM_RECIPES=['Recipe_Alternate_Turbofuel_C','Recipe_Alternate_EnrichedCoal_C'];
// Power preferences other than auto/coal/fuel run turbofuel generators (directly or as the Phase 3 bridge).
export const powerNeedsTurbofuel=mainPower=>!['auto','coal','fuel'].includes(mainPower||'auto');
const ALT_IDS=new Set(DATA.recipes.filter(r=>r.alternate).map(r=>r.id));
export const RAW=['Iron Ore','Copper Ore','Limestone','Coal','Caterium Ore','Raw Quartz','Sulfur','Bauxite','Uranium','SAM','Crude Oil','Nitrogen Gas','Water'];
export const DEFAULT_LIMITS={'Iron Ore':92100,'Copper Ore':36900,Limestone:69900,Coal:42300,'Caterium Ore':15000,'Raw Quartz':13500,Sulfur:10800,Bauxite:12300,Uranium:2100,SAM:10200,'Crude Oil':9900,'Nitrogen Gas':12000,Water:1000000};
export const PURE_LIMITS={'Iron Ore':152400,'Copper Ore':66000,Limestone:112800,Coal:74400,'Caterium Ore':20400,'Raw Quartz':20400,Sulfur:19200,Bauxite:20400,Uranium:6000,SAM:22800,'Crude Oil':18000,'Nitrogen Gas':13500,Water:1000000};
export const DELIVERIES={1:{'Smart Plating':50},2:{'Smart Plating':1000,'Versatile Framework':1000,'Automated Wiring':100},3:{'Versatile Framework':2500,'Modular Engine':500,'Adaptive Control Unit':100},4:{'Assembly Director System':500,'Magnetic Field Generator':500,'Thermal Propulsion Rocket':250,'Nuclear Pasta':100},5:{'Nuclear Pasta':1000,'Biochemical Sculptor':1000,'AI Expansion Server':256,'Ballistic Warp Drive':200}};
const err=message=>{throw Object.assign(new Error(message),{status:400});};
const choice=(v,allowed,fallback)=>v===undefined?fallback:allowed.includes(v)?v:err('Invalid profile option.');
const number=(v,min,max,fallback)=>v===undefined?fallback:Number.isFinite(v)&&v>=min&&v<=max?v:err(`Enter a number from ${min} to ${max}.`);
export function settings(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))err('Invalid settings.');
 const s={utilityPercent:number(input.utilityPercent,0,200,20),droneFuel:choice(input.droneFuel,droneFuels,'none'),droneFuelRate:number(input.droneFuelRate,0.01,10000,10),droneBridgeRate:number(input.droneBridgeRate,0.01,10000,10),worldSeed:input.worldSeed===undefined||input.worldSeed===''?'':String(number(Number(input.worldSeed),-2147483648,2147483647,1)),mainPower:choice(input.mainPower,powerOptions.map(x=>x[0]),'auto'),collectables:input.collectables===true,phase:choice(String(input.phase||'3'),['1','2','3','4','5'],'3'),purity:choice(input.purity,purities.map(x=>x[0]),'vanilla'),distribution:choice(input.distribution,distributions.map(x=>x[0]),'original'),multiplier:number(input.multiplier,0.1,1000,1),powerFactor:number(input.powerFactor,0,10,1),availablePowerGW:number(input.availablePowerGW,0,10000,0),recipes:choice(input.recipes,['standard','all','custom'],'standard'),pureIngots:!!input.pureIngots,sam:choice(input.sam,['avoid','needed','allow'],'needed'),nuclear:choice(input.nuclear,['none','sink','recycle'],'none'),uraniumReactors:number(input.uraniumReactors,1,1000,1),storage:choice(input.storage,storageOptions.map(x=>x[0]),'construction'),storageRate:number(input.storageRate,0.1,300,1),cellsPerMinute:number(input.cellsPerMinute,0,1000,0),goal:choice(input.goal,['minimal','balanced','timed','maximum'],'balanced'),hours:number(input.hours,0.25,2000,8),roundRates:input.roundRates!==false,wholeMachines:input.wholeMachines===true,limitsConfirmed:!!input.limitsConfirmed,modNotes:typeof input.modNotes==='string'?input.modNotes.slice(0,500):''};
 if(s.droneFuel==='Plutonium Fuel Rod'&&s.nuclear==='none')err('Plutonium drone fuel requires a nuclear power and waste-processing strategy.');
 s.limits={};const defaults=resourceDefaults(s.purity,s.distribution).limits;
 if((s.mainPower==='nuclear'||s.mainPower.endsWith('-nuclear'))&&s.nuclear==='none')err('Choose a nuclear waste strategy for a nuclear power preference.');
 for(const r of RAW)s.limits[r]=number(input.limits?.[r],0,10000000,defaults[r]);
 s.alternateRecipes=Array.isArray(input.alternateRecipes)?[...new Set(input.alternateRecipes.filter(x=>ALT_IDS.has(x)))].sort():[];
 if(s.recipes==='custom'&&powerNeedsTurbofuel(s.mainPower))s.alternateRecipes=[...new Set([...s.alternateRecipes,...MAM_RECIPES])].sort();
 return s;
}
const pureNames=['Alternate: Pure Iron Ingot','Alternate: Pure Copper Ingot','Alternate: Pure Caterium Ingot','Alternate: Pure Aluminum Ingot'];
const metals=['Iron Ingot','Copper Ingot','Caterium Ingot','Aluminum Ingot'];
const construction=['Iron Plate','Iron Rod','Reinforced Iron Plate','Concrete','Wire','Cable','Copper Sheet','Steel Beam','Steel Pipe','Modular Frame','Encased Industrial Beam','Heavy Modular Frame','Motor','Computer','Plastic','Rubber','Alclad Aluminum Sheet','Aluminum Casing'];
const key=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function recipePool(s,phase,conversion){
 return DATA.recipes.filter(r=>!MAM_RECIPES.includes(r.id)||s.recipes!=='custom'||s.alternateRecipes.includes(r.id)).map(r=>MAM_RECIPES.includes(r.id)?{...r,alternate:false,name:r.name.replace('Alternate: ','')}:r).filter(r=>r.phase<=phase&&(s.recipes==='all'||!r.alternate||s.recipes==='custom'&&s.alternateRecipes.includes(r.id)||s.pureIngots&&pureNames.includes(r.name)))
 .filter(r=>!(s.pureIngots&&phase>=3&&metals.some(n=>r.outputs[n])&&!pureNames.includes(r.name)))
 .filter(r=>!Object.keys(r.outputs).some(x=>RAW.includes(x)&&x!=='Water')||conversion)
 .filter(r=>!['Uranium Fuel Rod','Plutonium Fuel Rod','Ficsonium','Ficsonium Fuel Rod','Encased Uranium Cell','Non-Fissile Uranium','Plutonium Pellet','Encased Plutonium Cell'].some(x=>r.outputs[x])||s.nuclear!=='none'||phase>=4&&s.droneFuel==='Uranium Fuel Rod'&&['Uranium Fuel Rod','Encased Uranium Cell'].some(x=>r.outputs[x]));
}
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
export function run(s,phase,{maximum=false,conversion=false,ignoreLimits=false,recipeIds=null}={}){
 if(s.wholeMachines&&!recipeIds){const base=run({...s,wholeMachines:false},phase,{maximum,conversion,ignoreLimits});if(!base.feasible)return base;return run(s,phase,{maximum,conversion,ignoreLimits,recipeIds:new Set(base.rows.map(r=>r.id))});}
 const pool=[...recipePool(s,phase,conversion),...generators(s,phase)].filter(r=>!recipeIds||recipeIds.has(r.id)||conversion&&Object.keys(r.outputs).some(n=>RAW.includes(n)&&n!=='Water'));
 const reachable=new Set(RAW);if(s.nuclear!=='none'&&phase>=4)reachable.add('Uranium Waste');if(s.nuclear==='recycle'&&phase===5)reachable.add('Plutonium Waste');
 for(let i=0;i<20;i++)for(const r of pool)if(Object.keys(r.inputs).every(n=>reachable.has(n)))Object.keys(r.outputs).forEach(n=>reachable.add(n));
 const allItems=new Set(pool.flatMap(r=>[...Object.keys(r.inputs),...Object.keys(r.outputs)]));
 const demand={};const storage={};const drone=droneSupply(s,phase),utilityFactor=1+(s.utilityPercent??20)/100;
 const candidates=[...reachable].filter(n=>!RAW.includes(n)&&!DATA.items[n]?.fluid&&!DATA.items[n]?.radioactive&&(DATA.items[n]?.sink||0)>0&&wantsStorage(n,s.storage));
 for(const n of candidates)if(reachable.has(n)){storage[n]=s.storageRate;demand[n]=s.storageRate;}
 const delivery={};const hours=s.goal==='minimal'?24:s.goal==='balanced'?8:s.hours;
 for(const [n,amount] of Object.entries(DELIVERIES[phase])){let rate=amount*s.multiplier/(hours*60);if(s.roundRates)rate=rate>=100?Math.round(rate/10)*10:rate>=10?Math.round(rate):Math.ceil(rate*10)/10;delivery[n]={target:Math.ceil(amount*s.multiplier),rate};if(!maximum)demand[n]=(demand[n]||0)+rate;}
 for(const [n,q] of Object.entries(drone))demand[n]=(demand[n]||0)+q;
 if(phase===5&&s.cellsPerMinute)demand['Singularity Cell']=(demand['Singularity Cell']||0)+s.cellsPerMinute;
 Object.keys(demand).forEach(n=>allItems.add(n));
 const model={optimize:maximum?'gain':'cost',opType:maximum?'max':'min',constraints:{},variables:{}};
 for(const n of allItems){const equality=DATA.items[n]?.fluid||DATA.items[n]?.radioactive||n.endsWith('Waste');model.constraints['item:'+n]=equality?{equal:demand[n]||0}:{min:demand[n]||0};}
 // A 20% planning allowance covers unmodelled mining, pumps and logistics; existing power is spare capacity.
 if(phase>=2||maximum)model.constraints.power={max:s.availablePowerGW*1000};
 for(const r of pool){
  const v={cost:1+(r.power>0?r.power/100000:0),power:r.power<0?r.power:r.power*s.powerFactor*utilityFactor};
  for(const [n,q] of Object.entries(r.outputs))v['item:'+n]=(v['item:'+n]||0)+q;
  for(const [n,q] of Object.entries(r.inputs))v['item:'+n]=(v['item:'+n]||0)-q;
  if(r.id==='power-uranium'){v.nuclear=1;model.constraints.nuclear={min:s.uraniumReactors};}
  model.variables[r.id]=v;
  if(s.wholeMachines&&Object.keys(r.outputs).some(n=>!DATA.items[n]?.fluid&&!RAW.includes(n))&&!/uranium|plutonium|ficsonium|waste|non-fissile/i.test([r.name,...Object.keys(r.inputs),...Object.keys(r.outputs)].join(' '))){(model.ints??={})[r.id]=1;}
 }
 for(const n of RAW){if(!allItems.has(n))continue;model.constraints['limit:'+n]={max:ignoreLimits?1e9:s.limits[n]};model.variables['raw:'+n]={cost:0.0001,['item:'+n]:1,['limit:'+n]:1};}
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
 const rows=pool.filter(r=>(solved[r.id]||0)>1e-6).map(r=>{const eq=solved[r.id];const machines=Math.ceil(eq-1e-6);return {...r,equivalent:eq,machines,lastClock:Math.max(0,(eq-machines+1)*100),inputs:Object.fromEntries(Object.entries(r.inputs).map(([n,q])=>[n,q*eq])),outputs:Object.fromEntries(Object.entries(r.outputs).map(([n,q])=>[n,q*eq])),peakMW:r.power<0?0:machines*r.power*s.powerFactor,generationMW:r.power<0?-r.power*eq:0};});
 const raw=Object.fromEntries(RAW.map(n=>[n,solved['raw:'+n]||0]));const used={},made={};for(const r of rows){for(const [n,q] of Object.entries(r.inputs))used[n]=(used[n]||0)+q;for(const [n,q] of Object.entries(r.outputs))made[n]=(made[n]||0)+q;}
 const surplus=Object.fromEntries(Object.keys(made).map(n=>[n,Math.max(0,made[n]-(used[n]||0)-(storage[n]||0)-(delivery[n]?.rate||0)-(drone[n]||0)-(n==='Singularity Cell'&&phase===5?s.cellsPerMinute:0))]).filter(([n,q])=>q>0.002&&!DATA.items[n]?.radioactive&&!DATA.items[n]?.fluid));
 const peakMW=rows.reduce((a,r)=>a+r.peakMW,0),generationMW=rows.reduce((a,r)=>a+r.generationMW,0);
 // Order by dependency depth; recycling loops are commissioned as a connected group.
 const producers={};for(const r of rows)for(const n of Object.keys(r.outputs))(producers[n]??=[]).push(r);
 const seen=new Set(),visiting=new Set(),ordered=[];function visit(r){if(seen.has(r.id)||visiting.has(r.id))return;visiting.add(r.id);for(const n of Object.keys(r.inputs))for(const p of producers[n]||[])visit(p);visiting.delete(r.id);seen.add(r.id);ordered.push(r);}rows.forEach(visit);
 return {feasible:true,rows:ordered,raw,storage,drone,delivery,surplus,plutoniumSink:solved['sink-plutonium']||0,peakMW,generationMW,requiredMW:peakMW*utilityFactor,additionalHeadroomMW:Math.max(0,peakMW*utilityFactor-generationMW-s.availablePowerGW*1000),hours:Math.max(...Object.values(delivery).map(d=>d.rate?d.target/d.rate/60:Infinity)),conversions:rows.filter(r=>Object.keys(r.outputs).some(n=>RAW.includes(n)&&n!=='Water')).map(r=>r.name)};
}
export function calculate(input){
 const s=settings(input);if(s.goal==='maximum'&&!s.limitsConfirmed)err('Confirm your available resource budgets before maximizing output.');
 const stages={};const warnings=[];
 for(let phase=1;phase<=5;phase++){
  let result=run(s,phase,{maximum:s.goal==='maximum',conversion:phase===5&&s.sam==='allow'});
  if(!result.feasible&&phase===5&&s.sam==='needed')result=run(s,phase,{maximum:s.goal==='maximum',conversion:true});
  // For maximum output, compare conversion when allowed only at a binding resource limit.
  if(s.goal==='maximum'&&phase===5&&s.sam==='needed'){const converted=run(s,phase,{maximum:true,conversion:true});if(converted.feasible&&(!result.feasible||converted.hours<result.hours-1e-6))result=converted;}
  if(!result.feasible){const diagnostic=run(s,phase,{conversion:phase===5&&s.sam!=='avoid',ignoreLimits:true});stages[phase]={...diagnostic,feasible:false,reason:result.solverStatus&&!/infeasible/i.test(result.solverStatus)?'The whole-machine solver could not finish this combination within its time limit. Try fewer alternates or precise balancing; no resource shortage has been established.':diagnostic.feasible?'The goal exceeds the available resource or power budgets. Increase the time or revise your budgets.':'The selected recipe/power options cannot support this combination. Allow alternates or change the goals.'};}
  else stages[phase]=result;
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
export const catalog=()=>({engine:ENGINE,alternates:DATA.recipes.filter(r=>r.alternate&&r.phase<=5).map(r=>({id:r.id,name:r.name.replace('Alternate: ',''),phase:r.phase,machine:r.machine,inputs:r.inputs,outputs:r.outputs,...(MAM_RECIPES.includes(r.id)?{mam:true}:{}),...(pureNames.includes(r.name)?{pure:true}:{})})).sort((a,b)=>a.name.localeCompare(b.name)),standardRecipes:DATA.recipes.filter(r=>!r.alternate).map(r=>({id:r.id,name:r.name,phase:r.phase,machine:r.machine,inputs:r.inputs,outputs:r.outputs})),storageOptions,distributions,purities,powerOptions,raw:RAW,limits:DEFAULT_LIMITS,pureLimits:PURE_LIMITS,goals:[{id:'minimal',name:'Minimal construction',description:'24-hour deliveries; minimize production-building equivalents.'},{id:'balanced',name:'Balanced progression',description:'8-hour deliveries with the selected storage and recipe preferences.'},{id:'timed',name:'Target completion time',description:'Calculate rates from your chosen hours per phase.'},{id:'maximum',name:'Maximum elevator output',description:'Fastest simultaneous delivery within confirmed resource budgets.'}]});




