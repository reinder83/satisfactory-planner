export const initialState=()=>({version:1,revision:0,checks:{},notes:{},deliveries:{},settings:{phase:'1'},customTasks:[],storageEdits:blankEdits(),taskEdits:blankTaskEdits(),factoryGroups:blankGroups()});
const blankEdits=()=>({floors:[],floorNames:{},bays:[],bayNames:{},slots:{},clearedSlots:[]});
const blankTaskEdits=()=>({order:{},removed:[],titles:{},bodies:{},links:{}});
const blankGroups=()=>({groups:[],assignments:{}});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const safeKey=k=>typeof k==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(k)&&!['__proto__','constructor','prototype'].includes(k);
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
export const builtinFloors=[['ground','Ground floor'],['upper','Upper floor'],['workshop','Workshop']];
const floorId=k=>typeof k==='string'&&(builtinFloors.some(([id])=>id===k)||/^cf-[a-z0-9]{4,32}$/.test(k));
const bayId=k=>typeof k==='string'&&/^[A-Z]{1,2}$/.test(k);
const slotAddr=k=>typeof k==='string'&&/^[A-Z]{1,2}0[1-8]$/.test(k);
const label=(v,max=80)=>typeof v==='string'&&v.trim()&&v.trim().length<=max;
const hasEdits=e=>e.floors.length||e.bays.length||e.clearedSlots.length||Object.keys(e.floorNames).length+Object.keys(e.bayNames).length+Object.keys(e.slots).length>0;
const phases=['1','2','3','4','5','post'];
const groupId=k=>typeof k==='string'&&/^fg-[a-z0-9]{4,32}$/.test(k);
const hasTaskEdits=e=>e.removed.length||Object.keys(e.order).length+Object.keys(e.titles).length+Object.keys(e.bodies).length+Object.keys(e.links).length>0;
const hasGroups=g=>g.groups.length||Object.keys(g.assignments).length>0;
function validateTaskEdits(raw){
 if(raw===undefined)return blankTaskEdits();
 if(!plain(raw))fail('Invalid build plan edits in backup.');
 const e=blankTaskEdits();
 if(raw.order!==undefined){
  if(!plain(raw.order))fail('Invalid step order.');
  for(const [ph,ids]of Object.entries(raw.order)){
   if(!phases.includes(ph)||!Array.isArray(ids)||ids.length>600||ids.some(k=>!safeKey(k))||new Set(ids).size!==ids.length)fail('Invalid step order.');
   if(ids.length)e.order[ph]=[...ids];
  }
 }
 if(raw.removed!==undefined){
  if(!Array.isArray(raw.removed)||raw.removed.length>2000||raw.removed.some(k=>!safeKey(k)))fail('Invalid removed steps.');
  e.removed=[...new Set(raw.removed)];
 }
 for(const [kind,max] of [['titles',240],['bodies',6000],['links',160]]){
  if(raw[kind]===undefined)continue;
  if(!plain(raw[kind])||Object.keys(raw[kind]).length>2000)fail('Invalid step edits.');
  for(const [k,v] of Object.entries(raw[kind])){if(!safeKey(k)||(kind==='links'?!safeKey(v):!label(v,max)))fail('Invalid step edit.');e[kind][k]=kind==='links'?v:v.trim();}
 }
 return e;
}
function validateGroups(raw){
 if(raw===undefined)return blankGroups();
 if(!plain(raw))fail('Invalid factory groups in backup.');
 const g=blankGroups();
 if(raw.groups!==undefined){
  if(!Array.isArray(raw.groups)||raw.groups.length>60)fail('Invalid factory groups.');
  const seen=new Set();
  g.groups=raw.groups.map(x=>{if(!plain(x)||!groupId(x.id)||seen.has(x.id)||!label(x.name))fail('Invalid factory group.');seen.add(x.id);return {id:x.id,name:x.name.trim()};});
 }
 if(raw.assignments!==undefined){
  if(!plain(raw.assignments)||Object.keys(raw.assignments).length>1000)fail('Invalid factory group assignments.');
  const known=new Set(g.groups.map(x=>x.id));
  for(const [k,list] of Object.entries(raw.assignments)){
   if(!safeKey(k)||!Array.isArray(list)||!list.length||list.length>12)fail('Invalid factory group assignment.');
   const used=new Set();
   g.assignments[k]=list.map(m=>{if(!plain(m)||!known.has(m.group)||used.has(m.group))fail('Invalid factory group assignment.');used.add(m.group);const rate=m.rate??null;if(rate!==null&&(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>10000000))fail('Invalid group production split.');return {group:m.group,rate};});
  }
 }
 return g;
}
// A new profile for a save you are already playing describes the same world.
// These groups say which of the previous profile's records are facts about that
// world (unlocks, the built storage room, deliveries handed in) rather than
// facts about its plan, so a new profile can start from them instead of an
// empty checklist. Plan-shaped records are carried only where the new plan
// still asks for the same or less work.
export const carryOptions=[
 ['unlocks','Milestone, MAM and hard-drive unlocks','Tier milestones, MAM research and the alternate recipes you confirmed in game.'],
 ['storage','Storage room layout and containers','Floors, bays, container names and every built, labelled, connected and verified position.'],
 ['commissioning','Power and start-up steps','Biomass, coal, fuel, nuclear, drone-fuel and portal commissioning you already finished.'],
 ['deliveries','Elevator deliveries handed in','The part counts you already delivered to the Space Elevator.'],
 ['notes','Notes and personal tasks','Save-wide notes, step notes and the tasks you added yourself.'],
 ['planEdits','Build-plan edits and factory groups','Renamed, reordered and removed steps, plus your factory group names.'],
 ['factories','Factory progress for unchanged lines','Production lines stay ticked where the new plan needs no more machines and no more input.'],
 ['picked','Treat this plan’s alternate recipes as unlocked','Ticks the unlock step for every alternate recipe you picked, including the ones your ingot and power preferences require.']
];
const carryPrefixes={
 unlocks:['unlock-','recipe-unlock-','hard-drives-'],
 storage:['slot-','storage-'],
 commissioning:['startup-','preferred-power-','drone-fuel-','early-base-','portal-supply','power-retained']
};
export const carryPicks=raw=>Object.fromEntries(carryOptions.map(([key])=>[key,raw===undefined?true:!!(plain(raw)&&raw[key])]));
// Rows of a plan keyed by the checklist address their step uses.
const planRows=plan=>{const rows=new Map();for(const [ph,stage] of Object.entries(plan?.stages||{}))for(const r of stage.rows||[])rows.set('calc-'+ph+'-'+r.id,r);return rows;};
// Hand-picking alternates states which recipes you own: the recipes ticked in
// the picker plus the ones a pure-ingot or power preference locks in for you,
// which reach the plan as alternate rows rather than as picks.
export function pickedRecipeUnlocks(plan){
 if(plan?.settings?.recipes!=='custom')return [];
 const ids=new Set(plan.settings.alternateRecipes||[]);
 for(const row of planRows(plan).values())if(row.alternate)ids.add(row.id);
 return [...ids].filter(id=>safeKey('recipe-unlock-'+id));
}
// Build the starting progress for a newly created profile. Without a source
// profile this is the blank state every earlier release produced.
export function newProfileState(plan,source,sourcePlan,raw){
 const state=initialState();
 state.settings.phase=plan?.settings?.phase||'3';
 if(plan)state.factoryGroups=defaultFactoryGroups(plan);
 if(!source)return {state:validateState(state),reviewCount:0,carried:0};
 const picks=carryPicks(raw);
 // For a save you already play those picks are in-game unlocks, so their
 // confirmation steps start ticked. Records copied below still win, including a
 // step the previous profile left deliberately unticked.
 if(picks.picked)for(const id of pickedRecipeUnlocks(plan))state.checks['recipe-unlock-'+id]=true;
 const prefixes=Object.entries(carryPrefixes).filter(([key])=>picks[key]).flatMap(([,list])=>list);
 for(const [key,value] of Object.entries(source.checks||{}))if(prefixes.some(p=>key.startsWith(p)))state.checks[key]=value;
 if(picks.deliveries)state.deliveries={...source.deliveries};
 if(picks.storage)for(const [key,value] of Object.entries(source.notes||{}))if(key.startsWith('slot-'))state.notes[key]=value;
 if(picks.storage)state.storageEdits=validateEdits(source.storageEdits);
 if(picks.notes){
  state.notes={...state.notes,...source.notes};
  state.customTasks=structuredClone(source.customTasks||[]);
  for(const task of state.customTasks)if(source.checks?.[task.id]!==undefined)state.checks[task.id]=source.checks[task.id];
 }
 if(picks.planEdits){
  state.taskEdits=validateTaskEdits(source.taskEdits);
  state.factoryGroups=mergeGroups(state.factoryGroups,source.factoryGroups,plan);
 }
 let reviewCount=0;
 if(picks.factories&&plan){
  const previous=planRows(sourcePlan);
  for(const [key,row] of planRows(plan)){
   if(!source.checks?.[key]||!safeKey(key))continue;
   const old=previous.get(key);
   const grown=!old||row.machines>old.machines||Object.entries(row.inputs||{}).some(([n,q])=>q>(old.inputs?.[n]||0)+0.001);
   state.checks[key]=!grown;
   if(grown)reviewCount++;
  }
 }
 const clean=validateState(state);
 return {state:clean,reviewCount,carried:Object.values(clean.checks).filter(Boolean).length};
}
// Keep the previous profile's group names and its assignments for rows the new
// plan still builds, then place the plan's remaining rows with the defaults.
function mergeGroups(defaults,raw,plan){
 const carried=validateGroups(raw);
 if(!carried.groups.length)return defaults;
 const rows=new Set([...planRows(plan).values()].map(r=>r.id));
 const groups=[...carried.groups];
 const known=new Set(groups.map(g=>g.id));
 const assignments={};
 for(const [key,list] of Object.entries(carried.assignments))if(rows.has(key))assignments[key]=list;
 for(const [key,list] of Object.entries(defaults.assignments)){
  if(assignments[key])continue;
  for(const m of list)if(!known.has(m.group)){const g=defaults.groups.find(x=>x.id===m.group);if(g&&groups.length<60){groups.push(g);known.add(g.id);}}
  if(list.every(m=>known.has(m.group)))assignments[key]=list;
 }
 return validateGroups({groups,assignments});
}
// Sharing a profile hands over the plan-shaped content (layout, groups, step
// edits, personal tasks) while the recipient starts with fresh progress.
export function shareState(s){
 const clean=validateState(structuredClone(s));
 clean.checks={};clean.notes={};clean.deliveries={};clean.revision=0;
 return validateState(clean);
}
function validateEdits(raw){
 if(raw===undefined)return blankEdits();
 if(!plain(raw))fail('Invalid storage layout in backup.');
 const e=blankEdits();
 if(raw.floors!==undefined){
  if(!Array.isArray(raw.floors)||raw.floors.length>12)fail('Invalid storage floors.');
  const seen=new Set();
  e.floors=raw.floors.map(f=>{if(!plain(f)||!/^cf-[a-z0-9]{4,32}$/.test(f.id)||seen.has(f.id)||!label(f.label))fail('Invalid storage floor.');seen.add(f.id);return {id:f.id,label:f.label.trim()};});
 }
 if(raw.bays!==undefined){
  if(!Array.isArray(raw.bays)||raw.bays.length>40)fail('Invalid storage bays.');
  const seen=new Set();
  e.bays=raw.bays.map(b=>{if(!plain(b)||!bayId(b.id)||seen.has(b.id)||!label(b.name)||!floorId(b.floor))fail('Invalid storage bay.');seen.add(b.id);return {id:b.id,name:b.name.trim(),floor:b.floor};});
 }
 for(const [kind,check,max] of [['floorNames',floorId,15],['bayNames',bayId,60],['slots',slotAddr,600]]){
  if(raw[kind]===undefined)continue;
  if(!plain(raw[kind])||Object.keys(raw[kind]).length>max)fail('Invalid storage names.');
  for(const [k,v] of Object.entries(raw[kind])){if(!check(k)||!label(v,kind==='slots'?120:80))fail('Invalid storage name.');e[kind][k]=v.trim();}
 }
 if(raw.clearedSlots!==undefined){
  if(!Array.isArray(raw.clearedSlots)||raw.clearedSlots.length>600||raw.clearedSlots.some(k=>!slotAddr(k)))fail('Invalid storage positions.');
  e.clearedSlots=[...new Set(raw.clearedSlots)];
 }
 return e;
}
export function validateState(s){
 if(!plain(s)||![1,2,3].includes(s.version))fail(s?.version>3?'This backup was made by a newer planner version. Update the app to import it.':'Choose a valid version 1 planner backup.');
 const clean=initialState();
 for(const kind of ['checks','notes','deliveries']){
  if(!plain(s[kind])||Object.keys(s[kind]).length>20000)fail('Invalid '+kind+' in backup.');
  clean[kind]={};
  for(const [k,v] of Object.entries(s[kind])){
   if(!safeKey(k))fail('Invalid record address.');
   if(kind==='checks'&&typeof v!=='boolean'||kind==='notes'&&(typeof v!=='string'||v.length>6000)||kind==='deliveries'&&(!Number.isSafeInteger(v)||v<0||v>1000000000))fail('Invalid '+kind+' value.');
   clean[kind][k]=v;
  }
 }
 if(!plain(s.settings)||!['1','2','3','4','5','post'].includes(s.settings.phase))fail('Invalid selected phase.');
 clean.settings={phase:s.settings.phase};
 if(!Array.isArray(s.customTasks)||s.customTasks.length>500)fail('Invalid personal tasks.');
 const seen=new Set();clean.customTasks=s.customTasks.map(t=>{
  if(!plain(t)||!safeKey(t.id)||!t.id.startsWith('custom-')||seen.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>240||!['1','2','3','4','5','post'].includes(t.phase))fail('Invalid personal task.');
  seen.add(t.id);return {id:t.id,title:t.title.trim(),phase:t.phase};
 });
 clean.storageEdits=validateEdits(s.storageEdits);
 clean.taskEdits=validateTaskEdits(s.taskEdits);
 clean.factoryGroups=validateGroups(s.factoryGroups);
 // Version 1 states never carry layout edits, so older planners keep importing
 // untouched saves; a state with layout edits is marked 2, and one with build
 // plan edits or factory groups is marked 3, so old versions refuse it instead
 // of silently dropping those edits.
 clean.version=hasTaskEdits(clean.taskEdits)||hasGroups(clean.factoryGroups)?3:hasEdits(clean.storageEdits)?2:1;
 clean.revision=Number.isSafeInteger(s.revision)&&s.revision>=0?s.revision:0;
 return clean;
}
export function mutate(s,op){
 if(!plain(op))fail('Invalid update.');
 if(op.type==='check'||op.type==='note'||op.type==='delivery'){
  if(!safeKey(op.key))fail('Invalid record address.');
  const kind={check:'checks',note:'notes',delivery:'deliveries'}[op.type];
  if(op.type==='note'&&typeof op.value==='string'&&!op.value.trim())delete s.notes[op.key];
  else s[kind][op.key]=op.value;
 }else if(op.type==='checks'){
  if(!Array.isArray(op.keys)||!op.keys.length||op.keys.length>1000||op.keys.some(k=>!safeKey(k))||typeof op.value!=='boolean')fail('Invalid checklist update.');
  for(const key of op.keys)s.checks[key]=op.value;
 }else if(op.type==='phase'){s.settings.phase=op.value;}
 else if(op.type==='addTask'){s.customTasks.push({id:op.id,title:op.title,phase:op.phase});}
 else if(op.type==='removeTask'){
  s.customTasks=s.customTasks.filter(t=>t.id!==op.id);delete s.checks[op.id];
  const e=s.taskEdits=validateTaskEdits(s.taskEdits);
  delete e.titles[op.id];delete e.bodies[op.id];delete e.links[op.id];
  e.removed=e.removed.filter(k=>k!==op.id);
  for(const ph of Object.keys(e.order))e.order[ph]=e.order[ph].filter(k=>k!==op.id);
 }
 else if(op.type.startsWith('task')){mutateTasks(s,op);}
 else if(op.type.startsWith('factory')){mutateGroups(s,op);}
 else if(op.type.startsWith('storage')){mutateLayout(s,op);}
 else fail('Unknown update.');
 return validateState(s);
}
function mutateTasks(s,op){
 const e=s.taskEdits=validateTaskEdits(s.taskEdits);
 if(op.type==='taskEdit'){
  if(!safeKey(op.id))fail('Invalid step.');
  for(const [kind,value,max] of [['titles',op.title,240],['bodies',op.body,6000]]){
   if(value===undefined)continue;
   if(typeof value!=='string'||value.length>max)fail('Invalid step text.');
   if(value.trim())e[kind][op.id]=value.trim();else delete e[kind][op.id];
  }
  if(op.link!==undefined){
   if(op.link===''||op.link===null)delete e.links[op.id];
   else{if(!safeKey(op.link))fail('Invalid linked factory.');e.links[op.id]=op.link;}
  }
 }else if(op.type==='taskRemove'){
  if(!safeKey(op.id))fail('Invalid step.');
  if(!e.removed.includes(op.id))e.removed.push(op.id);
 }else if(op.type==='taskRestore'){
  if(!safeKey(op.id))fail('Invalid step.');
  e.removed=e.removed.filter(k=>k!==op.id);
 }else if(op.type==='taskOrder'){
  if(!phases.includes(op.phase)||!Array.isArray(op.ids)||op.ids.length>600||op.ids.some(k=>!safeKey(k))||new Set(op.ids).size!==op.ids.length)fail('Invalid step order.');
  if(op.ids.length)e.order[op.phase]=[...op.ids];else delete e.order[op.phase];
 }else fail('Unknown update.');
}
function mutateGroups(s,op){
 const g=s.factoryGroups=validateGroups(s.factoryGroups);
 if(op.type==='factoryGroupAdd'){
  if(!groupId(op.id)||g.groups.some(x=>x.id===op.id)||!label(op.name))fail('Invalid factory group.');
  if(g.groups.length>=60)fail('You can keep up to 60 factory groups.');
  g.groups.push({id:op.id,name:op.name.trim()});
 }else if(op.type==='factoryGroupRename'){
  if(!g.groups.some(x=>x.id===op.id))fail('Unknown factory group.');
  if(!label(op.name))fail('Invalid group name.');
  g.groups.find(x=>x.id===op.id).name=op.name.trim();
 }else if(op.type==='factoryGroupRemove'){
  if(!g.groups.some(x=>x.id===op.id))fail('Unknown factory group.');
  g.groups=g.groups.filter(x=>x.id!==op.id);
  for(const [k,list] of Object.entries(g.assignments)){
   const kept=list.filter(m=>m.group!==op.id);
   if(kept.length)g.assignments[k]=kept;else delete g.assignments[k];
  }
 }else if(op.type==='factoryAssign'){
  if(!safeKey(op.key)||!Array.isArray(op.groups)||op.groups.length>12)fail('Invalid factory group assignment.');
  const known=new Set(g.groups.map(x=>x.id)),used=new Set();
  const list=op.groups.map(m=>{
   if(!plain(m)||!known.has(m.group)||used.has(m.group))fail('Invalid factory group assignment.');
   used.add(m.group);const rate=m.rate??null;
   if(rate!==null&&(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>10000000))fail('Enter a production rate above 0.');
   return {group:m.group,rate};
  });
  if(list.length)g.assignments[op.key]=list;else delete g.assignments[op.key];
 }else fail('Unknown update.');
}
function mutateLayout(s,op){
 const e=s.storageEdits=validateEdits(s.storageEdits===undefined?undefined:s.storageEdits);
 if(op.type==='storageFloorAdd'){
  if(!/^cf-[a-z0-9]{4,32}$/.test(op.id)||e.floors.some(f=>f.id===op.id)||!label(op.label))fail('Invalid floor.');
  e.floors.push({id:op.id,label:op.label.trim()});
 }else if(op.type==='storageFloorRename'){
  if(!floorId(op.id)||!(builtinFloors.some(([id])=>id===op.id)||e.floors.some(f=>f.id===op.id)))fail('Unknown floor.');
  if(typeof op.label==='string'&&!op.label.trim())delete e.floorNames[op.id];
  else{if(!label(op.label))fail('Invalid floor name.');e.floorNames[op.id]=op.label.trim();}
 }else if(op.type==='storageFloorRemove'){
  if(!e.floors.some(f=>f.id===op.id))fail('Only added floors can be removed.');
  if(e.bays.some(b=>b.floor===op.id))fail('Remove or move the bays on this floor first.');
  e.floors=e.floors.filter(f=>f.id!==op.id);delete e.floorNames[op.id];
 }else if(op.type==='storageBayAdd'){
  if(!bayId(op.id)||e.bays.some(b=>b.id===op.id)||!label(op.name)||!floorId(op.floor))fail('Invalid bay.');
  if(!(builtinFloors.some(([id])=>id===op.floor)||e.floors.some(f=>f.id===op.floor)))fail('Unknown floor.');
  e.bays.push({id:op.id,name:op.name.trim(),floor:op.floor});
 }else if(op.type==='storageBayRename'){
  if(!bayId(op.id))fail('Invalid bay.');
  if(typeof op.name==='string'&&!op.name.trim())delete e.bayNames[op.id];
  else{if(!label(op.name))fail('Invalid bay name.');e.bayNames[op.id]=op.name.trim();}
 }else if(op.type==='storageBayRemove'){
  if(!e.bays.some(b=>b.id===op.id))fail('Only added bays can be removed. Progress on handbook bays is preserved.');
  e.bays=e.bays.filter(b=>b.id!==op.id);delete e.bayNames[op.id];
  for(const k of Object.keys(e.slots))if(k.startsWith(op.id)&&slotAddr(k)&&k.slice(0,-2)===op.id)delete e.slots[k];
  e.clearedSlots=e.clearedSlots.filter(k=>k.slice(0,-2)!==op.id);
 }else if(op.type==='storageSlotAssign'){
  if(!slotAddr(op.key)||!label(op.name,120))fail('Invalid container.');
  e.slots[op.key]=op.name.trim();e.clearedSlots=e.clearedSlots.filter(k=>k!==op.key);
 }else if(op.type==='storageSlotClear'){
  if(!slotAddr(op.key))fail('Invalid container address.');
  delete e.slots[op.key];if(!e.clearedSlots.includes(op.key))e.clearedSlots.push(op.key);
 }else fail('Unknown update.');
}

// Default factory groups for newly calculated profiles: production areas keyed by each row's primary output.
const GROUP_NAMES=[['fg-iron01','Iron & steel works'],['fg-coppr1','Copper & caterium'],['fg-stone1','Concrete & quartz'],['fg-oilcp1','Oil & fuel campus'],['fg-alumn1','Aluminum campus'],['fg-elect1','Electronics'],['fg-parts1','Industrial parts'],['fg-projct','Project assembly'],['fg-nuclr1','Nuclear site'],['fg-quant1','Quantum & SAM'],['fg-convr1','Resource conversion'],['fg-power1','Power generation'],['fg-pack01','Packaging'],['fg-ammo01','Ammunition & equipment'],['fg-other1','Everything else']];
const GROUP_BY_ITEM={
 'Iron Ingot':'fg-iron01','Iron Plate':'fg-iron01','Iron Rod':'fg-iron01','Screws':'fg-iron01','Reinforced Iron Plate':'fg-iron01','Modular Frame':'fg-iron01','Steel Ingot':'fg-iron01','Steel Beam':'fg-iron01','Steel Pipe':'fg-iron01','Encased Industrial Beam':'fg-iron01','Heavy Modular Frame':'fg-iron01',
 'Copper Ingot':'fg-coppr1','Copper Sheet':'fg-coppr1','Wire':'fg-coppr1','Cable':'fg-coppr1','Quickwire':'fg-coppr1','Caterium Ingot':'fg-coppr1','Copper Powder':'fg-coppr1',
 'Concrete':'fg-stone1','Silica':'fg-stone1','Quartz Crystal':'fg-stone1','Dissolved Silica':'fg-stone1',
 'Plastic':'fg-oilcp1','Rubber':'fg-oilcp1','Heavy Oil Residue':'fg-oilcp1','Polymer Resin':'fg-oilcp1','Fuel':'fg-oilcp1','Turbofuel':'fg-oilcp1','Petroleum Coke':'fg-oilcp1','Rocket Fuel':'fg-oilcp1','Ionized Fuel':'fg-oilcp1','Compacted Coal':'fg-oilcp1','Liquid Biofuel':'fg-oilcp1',
 'Alumina Solution':'fg-alumn1','Aluminum Scrap':'fg-alumn1','Aluminum Ingot':'fg-alumn1','Aluminum Casing':'fg-alumn1','Alclad Aluminum Sheet':'fg-alumn1',
 'Circuit Board':'fg-elect1','Computer':'fg-elect1','Supercomputer':'fg-elect1','High-Speed Connector':'fg-elect1','Crystal Oscillator':'fg-elect1','AI Limiter':'fg-elect1','Radio Control Unit':'fg-elect1',
 'Rotor':'fg-parts1','Stator':'fg-parts1','Motor':'fg-parts1','Heat Sink':'fg-parts1','Cooling System':'fg-parts1','Battery':'fg-parts1','Electromagnetic Control Rod':'fg-parts1','Fused Modular Frame':'fg-parts1','Pressure Conversion Cube':'fg-parts1','Turbo Motor':'fg-parts1',
 'Smart Plating':'fg-projct','Versatile Framework':'fg-projct','Automated Wiring':'fg-projct','Modular Engine':'fg-projct','Adaptive Control Unit':'fg-projct','Assembly Director System':'fg-projct','Magnetic Field Generator':'fg-projct','Thermal Propulsion Rocket':'fg-projct','Nuclear Pasta':'fg-projct','Biochemical Sculptor':'fg-projct','AI Expansion Server':'fg-projct','Ballistic Warp Drive':'fg-projct',
 'Sulfuric Acid':'fg-nuclr1','Nitric Acid':'fg-nuclr1','Encased Uranium Cell':'fg-nuclr1','Uranium Fuel Rod':'fg-nuclr1','Non-Fissile Uranium':'fg-nuclr1','Plutonium Pellet':'fg-nuclr1','Encased Plutonium Cell':'fg-nuclr1','Plutonium Fuel Rod':'fg-nuclr1','Ficsonium':'fg-nuclr1','Ficsonium Fuel Rod':'fg-nuclr1','Uranium Waste':'fg-nuclr1','Plutonium Waste':'fg-nuclr1',
 'Reanimated SAM':'fg-quant1','SAM Fluctuator':'fg-quant1','Dark Matter Residue':'fg-quant1','Excited Photonic Matter':'fg-quant1','Time Crystal':'fg-quant1','Dark Matter Crystal':'fg-quant1','Diamonds':'fg-quant1','Ficsite Ingot':'fg-quant1','Ficsite Trigon':'fg-quant1','Singularity Cell':'fg-quant1','Superposition Oscillator':'fg-quant1','Neural-Quantum Processor':'fg-quant1','Power Shard':'fg-quant1','Alien Power Matrix':'fg-quant1',
 'Caterium Ore':'fg-convr1','Bauxite':'fg-convr1','Coal':'fg-convr1','Copper Ore':'fg-convr1','Nitrogen Gas':'fg-convr1','Iron Ore':'fg-convr1','Raw Quartz':'fg-convr1','Sulfur':'fg-convr1','Limestone':'fg-convr1','Uranium':'fg-convr1','Crude Oil':'fg-convr1',
 'Biomass':'fg-power1','Solid Biofuel':'fg-power1',
 'Empty Canister':'fg-pack01','Empty Fluid Tank':'fg-pack01','Packaged Fuel':'fg-pack01',
 'Black Powder':'fg-ammo01','Smokeless Powder':'fg-ammo01','Iron Rebar':'fg-ammo01','Stun Rebar':'fg-ammo01','Shatter Rebar':'fg-ammo01','Explosive Rebar':'fg-ammo01','Nobelisk':'fg-ammo01','Pulse Nobelisk':'fg-ammo01','Cluster Nobelisk':'fg-ammo01','Nuke Nobelisk':'fg-ammo01','Rifle Ammo':'fg-ammo01','Homing Rifle Ammo':'fg-ammo01','Turbo Rifle Ammo':'fg-ammo01','Gas Filter':'fg-ammo01','Iodine-Infused Filter':'fg-ammo01','Fabric':'fg-ammo01','Portable Miner':'fg-ammo01'};
export function defaultFactoryGroups(plan){
 const assignments={};
 for(const stage of Object.values(plan?.stages||{}))for(const r of stage.rows||[]){
  if(assignments[r.id])continue;
  let group;
  if(String(r.id).startsWith('power-'))group=/uranium|plutonium|ficsonium/.test(r.id)?'fg-nuclr1':'fg-power1';
  else{const out=Object.keys(r.outputs||{})[0];group=out?(out.startsWith('Packaged')?'fg-pack01':GROUP_BY_ITEM[out]||'fg-other1'):'fg-power1';}
  assignments[r.id]=[{group,rate:null}];
 }
 const used=new Set(Object.values(assignments).map(a=>a[0].group));
 return {groups:GROUP_NAMES.filter(([gid])=>used.has(gid)).map(([gid,label])=>({id:gid,name:label})),assignments};
}
