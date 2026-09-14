export const initialState=()=>({version:1,revision:0,checks:{},notes:{},deliveries:{},settings:{phase:'1'},customTasks:[],storageEdits:blankEdits()});
const blankEdits=()=>({floors:[],floorNames:{},bays:[],bayNames:{},slots:{},clearedSlots:[]});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const safeKey=k=>typeof k==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(k)&&!['__proto__','constructor','prototype'].includes(k);
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
export const builtinFloors=[['ground','Ground floor'],['upper','Upper floor'],['workshop','Workshop']];
const floorId=k=>typeof k==='string'&&(builtinFloors.some(([id])=>id===k)||/^cf-[a-z0-9]{4,32}$/.test(k));
const bayId=k=>typeof k==='string'&&/^[A-Z]{1,2}$/.test(k);
const slotAddr=k=>typeof k==='string'&&/^[A-Z]{1,2}0[1-8]$/.test(k);
const label=(v,max=80)=>typeof v==='string'&&v.trim()&&v.trim().length<=max;
const hasEdits=e=>e.floors.length||e.bays.length||e.clearedSlots.length||Object.keys(e.floorNames).length+Object.keys(e.bayNames).length+Object.keys(e.slots).length>0;
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
 if(!plain(s)||![1,2].includes(s.version))fail(s?.version>2?'This backup was made by a newer planner version. Update the app to import it.':'Choose a valid version 1 planner backup.');
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
 // Version 1 states never carry layout edits, so older planners keep importing
 // untouched saves; a state with edits is marked 2 and old versions refuse it
 // instead of silently dropping the layout.
 clean.version=hasEdits(clean.storageEdits)?2:1;
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
 else if(op.type==='removeTask'){s.customTasks=s.customTasks.filter(t=>t.id!==op.id);delete s.checks[op.id];}
 else if(op.type.startsWith('storage')){mutateLayout(s,op);}
 else fail('Unknown update.');
 return validateState(s);
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
