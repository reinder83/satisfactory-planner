import {validateState} from './state.js';
export const transferFormat='satisfactory-planner-saves';
const title=x=>{if(typeof x!=='string'||!x.trim()||x.length>80)throw Error('Invalid save or profile name.');return x;};
export function validateTransfer(data){
 if(data?.format!==transferFormat||data.version!==1||!Array.isArray(data.saves)||data.saves.length>50)throw Error('Choose a full planner save export.');
 // Only accept data objects; executable links never belong in a portable handbook.
 const text=JSON.stringify(data);if(text.length>50*1024*1024||/"(?:__proto__|constructor|prototype)"\s*:/.test(text))throw Error('Invalid or oversized save export.');
 const saves=data.saves.map(s=>{
  if(!Array.isArray(s.profiles)||!s.profiles.length||s.profiles.length>30)throw Error('Invalid profiles in export.');
  const profiles=s.profiles.map(p=>{
   if(!['calculated','original'].includes(p.kind)||typeof p.id!=='string')throw Error('Invalid profile.');
   if(p.kind==='calculated'){
    if(!p.plan?.settings||!p.plan?.stages||!Array.isArray(p.plan.warnings))throw Error('Missing calculation snapshot.');
    for(const phase of ['1','2','3','4','5']){const stage=p.plan.stages[phase];if(!stage||!Array.isArray(stage.rows||[])||typeof stage.feasible!=='boolean')throw Error('Invalid calculation stage.');}
   }else if(!p.handbook?.factories||!p.handbook?.phases||!p.handbook?.storage)throw Error('This original profile needs its full handbook export.');
   const handbook=p.kind==='original'?structuredClone(p.handbook):undefined;
   if(handbook)handbook.sources=(handbook.sources||[]).filter(s=>{try{return new URL(s.url).protocol==='https:';}catch{return false;}});
   return {id:p.id,name:title(p.name),kind:p.kind,plan:p.kind==='calculated'?structuredClone(p.plan):null,...(handbook?{handbook}:{}),state:validateState(p.state)};
  });
  if(new Set(profiles.map(p=>p.id)).size!==profiles.length||!profiles.some(p=>p.id===s.activeProfile))throw Error('Invalid active profile.');
  return {id:String(s.id),name:title(s.name),activeProfile:s.activeProfile,profiles};
 });
 return {format:transferFormat,version:1,saves};
}
