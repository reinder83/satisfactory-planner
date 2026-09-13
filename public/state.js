export const initialState=()=>({version:1,revision:0,checks:{},notes:{},deliveries:{},settings:{phase:'1'},customTasks:[]});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const safeKey=k=>typeof k==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(k)&&!['__proto__','constructor','prototype'].includes(k);
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
export function validateState(s){
 if(!plain(s)||s.version!==1)fail('Choose a valid version 1 planner backup.');
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
 clean.revision=Number.isSafeInteger(s.revision)&&s.revision>=0?s.revision:0;
 return clean;
}
export function mutate(s,op){
 if(!plain(op))fail('Invalid update.');
 if(op.type==='check'||op.type==='note'||op.type==='delivery'){
  if(!safeKey(op.key))fail('Invalid record address.');
  const kind={check:'checks',note:'notes',delivery:'deliveries'}[op.type];
  s[kind][op.key]=op.value;
 }else if(op.type==='phase'){s.settings.phase=op.value;}
 else if(op.type==='addTask'){s.customTasks.push({id:op.id,title:op.title,phase:op.phase});}
 else if(op.type==='removeTask'){s.customTasks=s.customTasks.filter(t=>t.id!==op.id);delete s.checks[op.id];}
 else fail('Unknown update.');
 return validateState(s);
}
