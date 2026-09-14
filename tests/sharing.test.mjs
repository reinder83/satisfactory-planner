import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {createBrowserApi} from '../public/browser-api.js';
import {calculate} from '../planner.mjs';
async function start(dir){const server=await createApp({dataDir:dir,password:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:'http://127.0.0.1:'+server.address().port};}
const close=s=>new Promise(r=>s.close(r));
const post=(url,endpoint,b,headers={})=>fetch(url+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Planner-Request':'1',...headers},body:JSON.stringify(b)});
const json=async r=>{assert.ok(r.ok,await r.clone().text());return r.json();};

test('a shared profile exports one profile without progress and imports as a fresh copy',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planner-share-'));const app=await start(dir);
 try{
  const a=await json(await post(app.url,'/api/profiles',{saveName:'Shared world',name:'Balanced',settings:{}}));
  const ah={'X-Save-Id':a.saveId,'X-Profile-Id':a.profileId};
  await post(app.url,'/api/update',{type:'check',key:'calc-3-iron-ingot',value:true},ah);
  await post(app.url,'/api/update',{type:'note',key:'global',value:'Private seed notes'},ah);
  await post(app.url,'/api/update',{type:'factoryGroupAdd',id:'fg-cable01',name:'Cable factory'},ah);
  const share=await json(await fetch(`${app.url}/api/export-saves?save=${a.saveId}&profile=${a.profileId}&share=1`));
  assert.equal(share.saves.length,1);
  assert.equal(share.saves[0].profiles.length,1,'only the shared profile is included');
  const state=share.saves[0].profiles[0].state;
  assert.deepEqual(state.checks,{});
  assert.deepEqual(state.notes,{});
  assert.equal(state.factoryGroups.groups[0].name,'Cable factory','the factory grouping travels with the shared plan');
  assert.ok(share.saves[0].profiles[0].plan,'the calculation snapshot travels with the share');
  assert.ok(!JSON.stringify(share).includes('Private seed notes'));
  const w=await json(await post(app.url,'/api/import-saves',share));
  assert.equal(w.saves.length,3,'the default save, the shared world and the imported copy');
  const importedSave=w.saves.find(s=>s.id!==a.saveId&&s.name==='Shared world');
  assert.ok(importedSave,'the share imports as a new copy');
  assert.equal(importedSave.profiles[0].completed,0,'the imported copy starts without progress');
  const original=await json(await fetch(app.url+'/api/state',{headers:ah}));
  assert.equal(original.checks['calc-3-iron-ingot'],true,'sharing never changes the source profile');
  assert.equal(original.notes.global,'Private seed notes');
  const scoped=await json(await fetch(`${app.url}/api/export-saves?save=${a.saveId}&profile=${a.profileId}`));
  assert.equal(scoped.saves[0].profiles[0].state.notes.global,'Private seed notes','without share=1 the scoped export keeps progress');
  assert.equal((await fetch(`${app.url}/api/export-saves?save=missing`)).status,404);
  assert.equal((await fetch(`${app.url}/api/export-saves?save=${a.saveId}&profile=missing`)).status,404);
 }finally{await close(app.server);await fs.rm(dir,{recursive:true,force:true});}
});

test('duplicating a profile copies plan and progress and keeps the original independent',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planner-copy-'));const app=await start(dir);
 try{
  const a=await json(await post(app.url,'/api/profiles',{saveName:'Copy world',name:'Precise',settings:{}}));
  const ah={'X-Save-Id':a.saveId,'X-Profile-Id':a.profileId};
  await post(app.url,'/api/update',{type:'check',key:'calc-3-iron-ingot',value:true},ah);
  const b=await json(await post(app.url,'/api/duplicate-profile',{saveId:a.saveId,profileId:a.profileId}));
  assert.notEqual(b.profileId,a.profileId);
  const bh={'X-Save-Id':b.saveId,'X-Profile-Id':b.profileId};
  const copy=await json(await fetch(app.url+'/api/context',{headers:bh}));
  assert.match(copy.profile.name,/· copy$/);
  assert.equal(copy.state.checks['calc-3-iron-ingot'],true,'the copy starts from the current progress');
  assert.ok(copy.plan,'the copy keeps the frozen calculation snapshot');
  await post(app.url,'/api/update',{type:'check',key:'calc-3-iron-ingot',value:false},bh);
  await post(app.url,'/api/update',{type:'note',key:'global',value:'Experiment'},bh);
  const original=await json(await fetch(app.url+'/api/state',{headers:ah}));
  assert.equal(original.checks['calc-3-iron-ingot'],true,'edits in the copy never reach the original');
  assert.equal(original.notes.global,undefined);
  assert.equal((await post(app.url,'/api/duplicate-profile',{saveId:a.saveId})).status,400);
  assert.equal((await post(app.url,'/api/duplicate-profile',{saveId:a.saveId,profileId:'missing'})).status,404);
 }finally{await close(app.server);await fs.rm(dir,{recursive:true,force:true});}
});

test('browser edition shares and duplicates through the same portable format',async()=>{
 let data={version:1,activeSave:null,saves:[]};
 const store={async transaction(change){const copy=structuredClone(data);if(!change)return copy;const result=change(copy);data=copy;return structuredClone(result);}};
 const api=createBrowserApi(store,calculate,{}),post=(route,body)=>api(route,{body:JSON.stringify(body)});
 const a=await post('/api/profiles',{saveName:'Browser world',name:'Balanced',settings:{phase:'1',goal:'minimal'}});
 await post('/api/update',{type:'check',key:'calc-1-iron-ingot',value:true});
 await post('/api/update',{type:'factoryGroupAdd',id:'fg-cable01',name:'Cable factory'});
 const share=await api(`/api/export-saves?save=${a.saveId}&profile=${a.profileId}&share=1`);
 assert.equal(share.saves.length,1);
 assert.deepEqual(share.saves[0].profiles[0].state.checks,{});
 assert.equal(share.saves[0].profiles[0].state.factoryGroups.groups.length,1);
 assert.equal(data.lastBackup,undefined,'a share is not recorded as a full backup');
 await post('/api/import-saves',share);
 assert.equal((await api('/api/workspace')).saves.length,2);
 const copy=await post('/api/duplicate-profile',{saveId:a.saveId,profileId:a.profileId});
 assert.notEqual(copy.profileId,a.profileId);
 assert.equal((await api('/api/state')).checks['calc-1-iron-ingot'],true,'the duplicate becomes active and carries progress');
 await post('/api/update',{type:'check',key:'calc-1-iron-ingot',value:false});
 const original=await api(`/api/state?save=${a.saveId}&profile=${a.profileId}`);
 assert.equal(original.checks['calc-1-iron-ingot'],true,'the original profile is untouched by the experiment');
 const full=await api('/api/export-saves');
 assert.ok(data.lastBackup,'a full export still counts as a backup');
 assert.equal(full.saves.length,2);
});
