import {openBrowserStore} from './browser-store.js';
import {initialState,validateState,mutate,shareState,defaultFactoryGroups} from './state.js';
import {validateTransfer,transferFormat} from './transfer.js';
export const browserMode=globalThis.PLANNER_BROWSER===true;
let instance;
export function createBrowserApi(store,calculator,catalog){
 const uid=()=>crypto.randomUUID();
 const cleanName=n=>{if(typeof n!=='string'||!n.trim()||n.length>80)throw Error('Enter a name with 1–80 characters.');return n.trim();};
 const summary=d=>({browser:true,accountsEnabled:false,user:{id:'browser',username:'This browser'},activeSave:d.activeSave,catalog,lastBackup:d.lastBackup,saves:d.saves.map(s=>({...s,profiles:s.profiles.map(p=>({id:p.id,name:p.name,kind:p.kind,settings:p.plan?.settings,completed:Object.values(p.state.checks).filter(Boolean).length,phase:p.state.settings.phase}))}))});
 const scope=(d,url,headers={},body)=>{const saveId=body?.saveId||headers['X-Save-Id']||url.searchParams.get('save')||d.activeSave;const save=d.saves.find(s=>s.id===saveId);if(!save)throw Error('Save not found.');const profileId=body?.profileId||headers['X-Profile-Id']||url.searchParams.get('profile')||save.activeProfile;const profile=save.profiles.find(p=>p.id===profileId);if(!profile)throw Error('Profile not found.');return {save,profile};};
 return async function request(route,options={}){
  const url=new URL(route,'https://planner.invalid'),ep=url.pathname,body=options.body?JSON.parse(options.body):{},headers=options.headers||{};
  if(ep==='/api/workspace')return summary(await store.transaction());
  if(ep==='/api/preview')return calculator(body.settings,options.onProgress);
  if(ep==='/api/profiles'){
   const profileName=cleanName(body.name),saveName=body.saveId?null:cleanName(body.saveName),plan=await calculator(body.settings,options.onProgress),profileId=uid();
   return store.transaction(d=>{let save=d.saves.find(s=>s.id===body.saveId);if(body.saveId&&!save)throw Error('Save not found.');if(!save){if(d.saves.length>=50)throw Error('Save limit reached.');save={id:uid(),name:saveName,profiles:[]};d.saves.push(save);}if(save.profiles.length>=30)throw Error('Profile limit reached.');const state={...initialState(),checks:{},deliveries:{}};state.settings.phase=plan.settings.phase;state.factoryGroups=defaultFactoryGroups(plan);save.profiles.push({id:profileId,name:profileName,kind:'calculated',plan,state});save.activeProfile=profileId;d.activeSave=save.id;return {saveId:save.id,profileId,workspace:summary(d)};});
  }
  if(ep==='/api/export-saves'){
   const saveId=url.searchParams.get('save'),profileId=url.searchParams.get('profile'),share=url.searchParams.get('share')==='1';
   return store.transaction(d=>{
    let saves=structuredClone(d.saves);
    if(saveId){saves=saves.filter(s=>s.id===saveId);if(!saves.length)throw Error('Save not found.');}
    if(profileId){saves=saves.filter(s=>s.profiles.some(p=>p.id===profileId));if(!saves.length)throw Error('Profile not found.');}
    for(const s of saves){
     if(profileId)s.profiles=s.profiles.filter(p=>p.id===profileId);
     if(!s.profiles.some(p=>p.id===s.activeProfile))s.activeProfile=s.profiles[0].id;
     if(share)for(const p of s.profiles)p.state=shareState(p.state);
    }
    const exportedAt=new Date().toISOString();
    if(!saveId&&!profileId&&!share)d.lastBackup=exportedAt;
    return {format:transferFormat,version:1,exportedAt,saves};
   });
  }
  if(ep==='/api/duplicate-profile'){
   return store.transaction(d=>{
    const {save,profile}=scope(d,url,headers,body);
    if(save.profiles.length>=30)throw Error('Profile limit reached.');
    const profileId=uid();
    save.profiles.push({...structuredClone(profile),id:profileId,name:(profile.name+' · copy').slice(0,80)});
    save.activeProfile=profileId;d.activeSave=save.id;
    return {saveId:save.id,profileId,workspace:summary(d)};
   });
  }
  if(ep==='/api/import-saves'){
   const imported=validateTransfer(body);
   return store.transaction(d=>{if(d.saves.length+imported.saves.length>50)throw Error('Import would exceed the save limit.');for(const s of imported.saves){const old=s.activeProfile;for(const p of s.profiles){const previous=p.id;p.id=uid();if(previous===old)s.activeProfile=p.id;}s.id=uid();d.saves.push(s);d.activeSave=s.id;}return summary(d);});
  }
  if(ep==='/api/round-up'){
   const before=scope(await store.transaction(),url,headers);if(before.profile.kind!=='calculated'||before.profile.plan.settings.wholeMachines)throw Error('Choose a calculated profile without whole-machine production.');const rounded=await calculator({...before.profile.plan.settings,wholeMachines:true},options.onProgress),profileId=uid();
   return store.transaction(d=>{const {save,profile}=scope(d,url,headers);if(save.profiles.length>=30)throw Error('Profile limit reached.');const state=structuredClone(profile.state);let reviewCount=0;for(const [ph,stage]of Object.entries(rounded.stages))for(const row of stage.rows||[]){const old=profile.plan.stages[ph]?.rows?.find(r=>r.id===row.id);if(!old||row.machines>old.machines||Object.entries(row.inputs).some(([n,q])=>q>(old.inputs[n]||0)+.001)){const key='calc-'+ph+'-'+row.id;if(state.checks[key]){state.checks[key]=false;reviewCount++;}}}save.profiles.push({id:profileId,name:(profile.name+' · whole machines').slice(0,80),kind:'calculated',plan:rounded,state});save.activeProfile=profileId;d.activeSave=save.id;return {saveId:save.id,profileId,reviewCount,workspace:summary(d)};});
  }
  const read=['/api/context','/api/state','/api/export'].includes(ep);
  const operation=d=>{
   const {save,profile}=scope(d,url,headers,['/api/select','/api/remove-profile'].includes(ep)?body:undefined);
   if(ep==='/api/context')return {save:{id:save.id,name:save.name},profile:{id:profile.id,name:profile.name,kind:profile.kind},state:profile.state,plan:profile.plan,handbook:profile.handbook};
   if(ep==='/api/state')return profile.state;
   if(ep==='/api/export')return {format:'satisfactory-planner-backup',profileId:profile.id,saveName:save.name,profileName:profile.name,state:profile.state};
   if(ep==='/api/select'){d.activeSave=save.id;save.activeProfile=profile.id;return summary(d);}
   if(ep==='/api/remove-profile'){if(body.confirmed!==true)throw Error('Confirm profile removal first.');save.profiles=save.profiles.filter(p=>p.id!==profile.id);if(!save.profiles.length)d.saves=d.saves.filter(s=>s.id!==save.id);else if(save.activeProfile===profile.id)save.activeProfile=save.profiles[0].id;if(!d.saves.some(s=>s.id===d.activeSave))d.activeSave=d.saves[0]?.id||null;return summary(d);}
   if(ep==='/api/rename'){if(body.target==='save')save.name=cleanName(body.name);else if(body.target==='profile')profile.name=cleanName(body.name);else throw Error('Invalid rename target.');return summary(d);}
   if(ep==='/api/update'||ep==='/api/import'){
    if(ep==='/api/import'&&body.profileId&&body.profileId!==profile.id)throw Error('Switch to the matching profile before restoring progress.');
    const next=ep==='/api/update'?mutate(structuredClone(profile.state),body):validateState(body.format?body.state:body);
    if(profile.kind==='original'&&!['3','4','5','post'].includes(next.settings.phase))throw Error('The imported handbook covers Phase 3 onward.');next.revision=profile.state.revision+1;profile.state=next;return next;
   }
   throw Error('This feature needs a self-hosted server.');
  };
  return read?operation(await store.transaction()):store.transaction(operation);
 };
}
export async function browserRequest(route,options){
 if(!instance)instance=(async()=>{
  if(!globalThis.indexedDB)throw Error('Browser storage is unavailable. Use a regular browser window with site storage enabled.');
  let worker;let serial=0;const pending=new Map();
  const expire=()=>{worker?.terminate();worker=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Calculation timed out. Try fewer alternate recipes or a smaller goal.'));}pending.clear();};
  const calculate=(settings,onProgress)=>new Promise((resolve,reject)=>{
   if(!worker){worker=new Worker(new URL('./calculator-worker.js',import.meta.url),{type:'module'});worker.onmessage=e=>{const entry=pending.get(e.data.id);if(!entry)return;if(e.data.phase){clearTimeout(entry.timer);entry.timer=setTimeout(expire,180000);try{entry.onProgress?.(e.data.phase);}catch{}return;}pending.delete(e.data.id);clearTimeout(entry.timer);e.data.error?entry.reject(Error(e.data.error)):entry.resolve(e.data.result);};worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('The calculator could not load. Refresh and try again.'));}pending.clear();worker.terminate();worker=null;};}
   const id=++serial,timer=setTimeout(expire,180000);pending.set(id,{resolve,reject,timer,onProgress});worker.postMessage({id,settings});
  });
  const response=await fetch(new URL('./catalog.json',import.meta.url));if(!response.ok)throw Error('Could not load recipe catalog.');
  return createBrowserApi(openBrowserStore(indexedDB),calculate,await response.json());
 })();
 return (await instance)(route,options);
}
