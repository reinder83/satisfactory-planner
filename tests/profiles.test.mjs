import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp,initialState} from '../server.mjs';
import {calculate,RAW} from '../planner.mjs';
async function start(dir){const server=await createApp({dataDir:dir,password:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:'http://127.0.0.1:'+server.address().port};}
const close=s=>new Promise(r=>s.close(r));
const post=(url,endpoint,b,headers={})=>fetch(url+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Planner-Request':'1',...headers},body:JSON.stringify(b)});
const json=async r=>{assert.ok(r.ok,await r.clone().text());return r.json();};
test('profile removal requires confirmation, preserves other progress and survives an empty workspace',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planner-removal-'));let app=await start(dir);
 try{
  const a=await json(await post(app.url,'/api/profiles',{saveName:'Delete test',name:'A',kind:'original'}));
  const b=await json(await post(app.url,'/api/profiles',{saveId:a.saveId,name:'B',kind:'original'}));
  const ah={'X-Save-Id':a.saveId,'X-Profile-Id':a.profileId};
  await json(await post(app.url,'/api/update',{type:'note',key:'global',value:'Keep this'},ah));
  const remove={saveId:b.saveId,profileId:b.profileId};
  assert.equal((await post(app.url,'/api/remove-profile',remove)).status,400);
  let w=await json(await post(app.url,'/api/remove-profile',{...remove,confirmed:true}));
  assert.equal(w.saves.find(s=>s.id===a.saveId).activeProfile,a.profileId);
  assert.equal((await json(await fetch(app.url+'/api/state',{headers:ah}))).notes.global,'Keep this');
  await json(await post(app.url,'/api/remove-profile',{saveId:a.saveId,profileId:a.profileId,confirmed:true}));
  w=await json(await post(app.url,'/api/remove-profile',{saveId:'original-save',profileId:'original',confirmed:true}));
  assert.equal(w.saves.length,0);assert.equal(w.activeSave,null);
  await close(app.server);app=await start(dir);
  assert.equal((await json(await fetch(app.url+'/api/workspace'))).saves.length,0);
  await json(await post(app.url,'/api/profiles',{saveName:'Start again',name:'New',kind:'original'}));
 }finally{await close(app.server);await fs.rm(dir,{recursive:true,force:true});}
});
test('migration, separate saves and profiles, explicit scope across tabs, durable switching',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planner-profiles-'));const original=initialState();original.checks['built-iron']=true;original.notes.global='My original world';const old=JSON.stringify(original);await fs.writeFile(path.join(dir,'progress.json'),old);let app=await start(dir);
 try{
  const a=await json(await post(app.url,'/api/profiles',{saveName:'Second world',name:'Balanced',settings:{}}));const b=await json(await post(app.url,'/api/profiles',{saveId:a.saveId,name:'Minimal',settings:{goal:'minimal'}}));
  const ah={'X-Save-Id':a.saveId,'X-Profile-Id':a.profileId},bh={'X-Save-Id':b.saveId,'X-Profile-Id':b.profileId};
  let fresh=await json(await fetch(app.url+'/api/state',{headers:ah}));assert.deepEqual(fresh.checks,{});assert.deepEqual(fresh.deliveries,{});
  await post(app.url,'/api/update',{type:'check',key:'factory-one',value:true},ah);await post(app.url,'/api/update',{type:'note',key:'global',value:'Only A'},ah);
  fresh=await json(await fetch(app.url+'/api/state',{headers:bh}));assert.equal(fresh.checks['factory-one'],undefined);assert.equal(fresh.notes.global,undefined);
  await post(app.url,'/api/select',{saveId:a.saveId,profileId:a.profileId});await post(app.url,'/api/select',{saveId:b.saveId,profileId:b.profileId});
  assert.equal((await json(await fetch(app.url+'/api/state',{headers:ah}))).checks['factory-one'],true);
  const backup=await json(await fetch(app.url+'/api/export',{headers:ah}));assert.equal((await post(app.url,'/api/import',backup,bh)).status,400);
  assert.equal((await fetch(app.url+'/api/state',{headers:{...ah,'X-Profile-Id':'missing'}})).status,404);
  await close(app.server);app=await start(dir);assert.equal((await json(await fetch(app.url+'/api/state',{headers:ah}))).notes.global,'Only A');
  const restored=await json(await fetch(app.url+'/api/state?save=original-save&profile=original'));assert.deepEqual(restored,original);assert.equal(await fs.readFile(path.join(dir,'progress.json'),'utf8'),old);
 }finally{await close(app.server);await fs.rm(dir,{recursive:true,force:true});}
});
test('account setup requires host token; sessions and all data routes enforce ownership',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planner-users-'));let app=await start(dir);
 try{
  const owner={username:'owner-test',password:'Long-test-password-123',registration:true};assert.equal((await post(app.url,'/api/setup',{...owner,setupToken:'wrong'})).status,403);
  const setup=await post(app.url,'/api/setup',{...owner,setupToken:await fs.readFile(path.join(dir,'account-setup-token.txt'),'utf8')});assert.equal(setup.status,200);const ownerCookie=setup.headers.get('set-cookie').split(';')[0];assert.match(setup.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await fetch(app.url+'/api/state')).status,401);
  const signup=await post(app.url,'/api/register',{username:'second-user',password:'Different-long-password'});assert.equal(signup.status,200);const other={Cookie:signup.headers.get('set-cookie').split(';')[0]};
  assert.equal((await fetch(app.url+'/api/state?save=original-save&profile=original',{headers:other})).status,404);
  assert.equal((await post(app.url,'/api/select',{saveId:'original-save',profileId:'original'},other)).status,404);
  assert.equal((await post(app.url,'/api/remove-profile',{saveId:'original-save',profileId:'original',confirmed:true},other)).status,404);
  assert.equal((await post(app.url,'/api/profiles',{saveId:'original-save',name:'Intrusion',settings:{}},other)).status,404);
  assert.equal((await fetch(app.url+'/api/export?save=original-save&profile=original',{headers:other})).status,404);
  assert.equal((await post(app.url,'/api/update',{type:'check',key:'bad',value:true},{...other,'X-Save-Id':'original-save','X-Profile-Id':'original'})).status,404);
  const ws=await json(await fetch(app.url+'/api/workspace',{headers:other}));assert.deepEqual(ws.saves,[]);assert.equal(JSON.stringify(ws).includes('password'),false);
  const otherSave=await json(await post(app.url,'/api/profiles',{saveName:'Their world',name:'First profile',settings:{}},other));assert.ok(otherSave.saveId);
  await close(app.server);app=await start(dir);assert.equal((await fetch(app.url+'/api/state',{headers:{Cookie:ownerCookie}})).status,200);
  assert.equal((await post(app.url,'/api/login',{username:'owner-test',password:'Wrong-password-123'})).status,401);
  const login=await post(app.url,'/api/login',{username:'owner-test',password:owner.password});assert.equal(login.status,200);
  const session={Cookie:login.headers.get('set-cookie').split(';')[0]};await post(app.url,'/api/logout',{},session);assert.equal((await fetch(app.url+'/api/state',{headers:session})).status,401);
 }finally{await close(app.server);await fs.rm(dir,{recursive:true,force:true});}
});
test('calculator applies settings, protects storage, balances nuclear waste and verifies limits',()=>{
 const standard=calculate({roundRates:false});assert.equal(standard.stages[3].feasible,true);assert.ok(Math.abs(standard.stages[3].hours-8)<1e-8);
 const large=calculate({multiplier:10,roundRates:false,powerFactor:0.5,pureIngots:true,recipes:'all',nuclear:'recycle',storage:'all'});
 assert.equal(large.stages[3].delivery['Modular Engine'].target,5000);assert.equal(large.stages[5].feasible,true);
 assert.ok(large.stages[3].rows.some(r=>r.name==='Alternate: Pure Iron Ingot'));
 assert.ok(!large.stages[3].rows.some(r=>r.name==='Iron Ingot'));
 for(const ph of Object.values(large.stages)){
  if(!ph.feasible)continue;for(const n of RAW)assert.ok(ph.raw[n]<=large.settings.limits[n]+0.01);
  for(const [n,rate]of Object.entries(ph.storage)){const made=ph.rows.reduce((a,r)=>a+(r.outputs[n]||0),0),used=ph.rows.reduce((a,r)=>a+(r.inputs[n]||0),0);assert.ok(made-used>=rate+(ph.delivery[n]?.rate||0)-0.01,n);}
 }
 const final=large.stages[5];for(const waste of ['Uranium Waste','Plutonium Waste']){const balance=final.rows.reduce((a,r)=>a+(r.outputs[waste]||0)-(r.inputs[waste]||0),0);assert.ok(Math.abs(balance)<1e-5);}
 assert.equal(final.plutoniumSink,0);assert.ok(final.rows.some(r=>r.id==='power-ficsonium'));
 assert.throws(()=>calculate({goal:'maximum'}),/Confirm/);
 const max=calculate({goal:'maximum',limitsConfirmed:true,recipes:'all'});assert.ok(max.stages[5].feasible);assert.ok(max.stages[5].hours<standard.stages[5].hours);
 const impossible=calculate({limits:{'Iron Ore':0,'Copper Ore':0},sam:'avoid'});assert.equal(impossible.stages[3].feasible,false);
});

test('whole production recalculates upstream inputs and makes surplus without changing old profiles',async()=>{
 const rounded=calculate({wholeMachines:true});assert.equal(rounded.stages[3].feasible,true);const rubber=rounded.stages[3].rows.find(r=>r.name==='Rubber');assert.equal(rubber.equivalent,rubber.machines);assert.ok(Object.values(rounded.stages[3].surplus).some(q=>q>0));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planner-rounded-'));const app=await start(dir);
 try{
  const a=await json(await post(app.url,'/api/profiles',{saveName:'World',name:'Precise',settings:{}}));const headers={'X-Save-Id':a.saveId,'X-Profile-Id':a.profileId};await post(app.url,'/api/update',{type:'note',key:'global',value:'Keep this note'},headers);await post(app.url,'/api/update',{type:'check',key:'unlock-Schematic_2-1_C',value:true},headers);
  const old=await json(await fetch(app.url+'/api/context',{headers}));const b=await json(await post(app.url,'/api/round-up',{},headers));assert.notEqual(b.profileId,a.profileId);
  const newer=await json(await fetch(app.url+'/api/context',{headers:{...headers,'X-Profile-Id':b.profileId}}));assert.equal(newer.plan.settings.wholeMachines,true);assert.equal(newer.state.notes.global,'Keep this note');assert.equal(newer.state.checks['unlock-Schematic_2-1_C'],true);assert.deepEqual(await json(await fetch(app.url+'/api/context',{headers})),old);
 }finally{await close(app.server);await fs.rm(dir,{recursive:true,force:true});}
});

test('new calculated profiles start with default factory groups covering every production line',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planner-groups-'));const app=await start(dir);
 try{
  const created=await json(await post(app.url,'/api/profiles',{saveName:'Grouped',name:'Calc',kind:'calculated',settings:{}}));
  const state=await json(await fetch(app.url+'/api/state',{headers:{'X-Planner-Request':'1','x-save-id':created.saveId,'x-profile-id':created.profileId}}));
  const groups=state.factoryGroups;
  assert.ok(groups?.groups?.length>3,'several default groups exist');
  const plan=calculate({});
  const ids=new Set(Object.values(plan.stages).flatMap(p=>(p.rows||[]).map(r=>r.id)));
  for(const id of ids)assert.ok(groups.assignments[id]?.length,'row '+id+' is assigned to a group');
  for(const a of Object.values(groups.assignments))assert.ok(groups.groups.some(g=>g.id===a[0].group),'assignments point at existing groups');
  const original=await json(await post(app.url,'/api/profiles',{saveId:created.saveId,name:'Orig',kind:'original'}));
  const os2=await json(await fetch(app.url+'/api/state',{headers:{'X-Planner-Request':'1','x-save-id':original.saveId,'x-profile-id':original.profileId}}));
  assert.ok(!(os2.factoryGroups?.groups?.length),'original handbook profiles keep their built-in shared sites instead');
 }finally{await close(app.server);await fs.rm(dir,{recursive:true,force:true});}
});

test('custom recipe access limits alternates to the picked list',()=>{
 const plan=calculate({recipes:'custom',alternateRecipes:['Recipe_Alternate_ReinforcedIronPlate_2_C','not-a-recipe']});
 assert.deepEqual(plan.settings.alternateRecipes,['Recipe_Alternate_ReinforcedIronPlate_2_C'],'unknown ids are dropped');
 for(const stagePlan of Object.values(plan.stages))for(const r of stagePlan.rows||[])if(r.alternate)assert.equal(r.id,'Recipe_Alternate_ReinforcedIronPlate_2_C','only picked alternates appear');
 const none=calculate({recipes:'custom'});
 for(const stagePlan of Object.values(none.stages))for(const r of stagePlan.rows||[])assert.ok(!r.alternate,'empty selection behaves like standard recipes');
});
