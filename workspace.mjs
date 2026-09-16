import {validateTransfer,transferFormat} from './public/transfer.js';
import {shareState,defaultFactoryGroups} from './public/state.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {calculate,catalog} from './planner.mjs';
const scrypt=promisify(scryptCallback),id=()=>randomBytes(16).toString('hex'),digest=s=>createHash('sha256').update(s).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const name=value=>typeof value==='string'&&value.trim()&&value.length<=80?value.trim():fail('Enter a name with 1–80 characters.');
const publicUser=u=>u?{id:u.id,username:u.username,owner:u.id==='owner'}:null;
const authCookie=token=>`planner_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?2592000:0}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;
export async function openWorkspace({dataDir,initialState,validateState,mutate}){
 const file=path.join(dataDir,'workspace.json');let db;
 const blank=()=>({...initialState(),checks:{},deliveries:{}});
 const original=(state)=>({id:'original',name:'Original · 50× complete automation',kind:'original',state});
 try{db=JSON.parse(await fs.readFile(file,'utf8'));if(db.version!==2||!Array.isArray(db.users)||!Array.isArray(db.saves)||!Array.isArray(db.sessions)||!db.users.some(u=>u.id==='owner'))throw Error();for(const save of db.saves){if(!db.users.some(u=>u.id===save.userId)||!Array.isArray(save.profiles)||!save.profiles.some(p=>p.id===save.activeProfile))throw Error();for(const p of save.profiles)p.state=validateState(p.state);}}
 catch(e){if(e.code!=='ENOENT')throw new Error('Workspace could not be read; existing data has not been overwritten.');let legacy;try{legacy=validateState(JSON.parse(await fs.readFile(path.join(dataDir,'progress.json'),'utf8')));}catch(e){if(e.code==='ENOENT')legacy=initialState();else throw new Error('Progress could not be read; existing data has not been overwritten.');}
  db={version:2,revision:0,accountsEnabled:false,registration:false,users:[{id:'owner',username:'Local pioneer',activeSave:'original-save'}],saves:[{id:'original-save',name:'My Satisfactory save',userId:'owner',activeProfile:'original',profiles:[original(legacy)]}],sessions:[]};
  await fs.writeFile(file,JSON.stringify(db),{flag:'wx',mode:0o600});
 }
 const tokenFile=path.join(dataDir,'account-setup-token.txt');let setupToken;
 try{setupToken=(await fs.readFile(tokenFile,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;setupToken=randomBytes(24).toString('hex');await fs.writeFile(tokenFile,setupToken,{mode:0o600,flag:'wx'});}
 let queue=Promise.resolve();
 const commit=fn=>{const run=queue.then(async()=>{const next=structuredClone(db);const result=fn(next);next.revision=db.revision+1;await fs.writeFile(file+'.bak',JSON.stringify(db),{mode:0o600});await fs.writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await fs.rename(file+'.tmp',file);db=next;return result;});queue=run.catch(()=>{});return run;};
 const userFor=req=>{if(!db.accountsEnabled)return db.users.find(u=>u.id==='owner');const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('planner_session='))?.split('=')[1];const session=token&&db.sessions.find(s=>s.hash===digest(token)&&s.expires>Date.now());return session?db.users.find(u=>u.id===session.userId):null;};
 const summary=u=>({accountsEnabled:db.accountsEnabled,registration:db.registration,user:publicUser(u),activeSave:u?.activeSave,catalog:catalog(),saves:db.saves.filter(s=>s.userId===u?.id).map(s=>({id:s.id,name:s.name,activeProfile:s.activeProfile,profiles:s.profiles.map(p=>({id:p.id,name:p.name,kind:p.kind,settings:p.plan?.settings,completed:Object.values(p.state.checks).filter(Boolean).length,phase:p.state.settings.phase}))}))});
 const scope=(req,url,u)=>{const saveId=req.headers['x-save-id']||url.searchParams.get('save')||u.activeSave;const save=db.saves.find(s=>s.id===saveId&&s.userId===u.id);if(!save)fail('Save not found.',404);const profileId=req.headers['x-profile-id']||url.searchParams.get('profile')||save.activeProfile;const profile=save.profiles.find(p=>p.id===profileId);if(!profile)fail('Profile not found.',404);return {save,profile};};
 const throttles=new Map();function throttle(req){const key=req.socket.remoteAddress,now=Date.now();let v=throttles.get(key);if(!v||v.until<now){v={count:0,until:now+60000};throttles.set(key,v);}if(++v.count>20)fail('Too many attempts. Wait a minute and try again.',429);if(throttles.size>2000)for(const [k,v]of throttles)if(v.until<now)throttles.delete(k);}
 const authValues=b=>{const username=String(b.username||'').trim().toLowerCase();if(!/^[a-z0-9_-]{3,32}$/.test(username)||typeof b.password!=='string'||b.password.length<12||b.password.length>128)fail('Use a 3–32 character username and a password of 12–128 characters.');return username;};
 const makeSession=(d,userId,token)=>{d.sessions=d.sessions.filter(s=>s.expires>Date.now());d.sessions.push({hash:digest(token),userId,expires:Date.now()+2592000000});if(d.sessions.length>5000)d.sessions.shift();};
 return async function route(req,url,body){
  let u=userFor(req);const endpoint=url.pathname;const response=(data,status=200,headers={})=>({data,status,headers});
  if(endpoint==='/api/workspace'&&req.method==='GET')return response(summary(u));
  if(req.method==='POST'&&['/api/setup','/api/login','/api/register'].includes(endpoint)){
   throttle(req);const b=await body(req),username=authValues(b),token=randomBytes(32).toString('hex');
   if(endpoint==='/api/login'){
    if(!db.accountsEnabled)fail('Accounts are not enabled.');const found=db.users.find(x=>x.username===username);const [salt,hash]=(found?.password||'missing:'+ '0'.repeat(128)).split(':');const actual=Buffer.from(await scrypt(b.password,salt,64));if(!timingSafeEqual(actual,Buffer.from(hash,'hex')))fail('Incorrect username or password.',401);await commit(d=>makeSession(d,found.id,token));u=db.users.find(x=>x.id===found.id);
   }else{
    if(endpoint==='/api/setup'){if(db.accountsEnabled)fail('Accounts are already enabled.',409);if(typeof b.setupToken!=='string'||digest(b.setupToken)!==digest(setupToken))fail('Enter the setup token from the server data folder.',403);}
    else if(!db.accountsEnabled||!db.registration)fail('New accounts are not enabled on this server.',403);
    const salt=id(),hash=Buffer.from(await scrypt(b.password,salt,64)).toString('hex');let userId;
    await commit(d=>{if(d.users.some(x=>x.username===username))fail('That username is already in use.',409);if(endpoint==='/api/setup'){if(d.accountsEnabled)fail('Accounts are already enabled.',409);const owner=d.users.find(x=>x.id==='owner');owner.username=username;owner.password=salt+':'+hash;userId=owner.id;d.accountsEnabled=true;d.registration=!!b.registration;}else{if(d.users.length>=500)fail('This server has reached its account limit.');userId=id();d.users.push({id:userId,username,password:salt+':'+hash,activeSave:null});}makeSession(d,userId,token);});u=db.users.find(x=>x.id===userId);
   }
   return response(summary(u),200,{'Set-Cookie':authCookie(token)});
  }
  if(!u)fail('Sign in to continue.',401);
  if(endpoint==='/api/logout'&&req.method==='POST'){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('planner_session='))?.split('=')[1];if(token)await commit(d=>{d.sessions=d.sessions.filter(s=>s.hash!==digest(token));});return response({ok:true},200,{'Set-Cookie':authCookie('')});}
  if(endpoint==='/api/export-saves'&&req.method==='GET'){
   const handbook=JSON.parse(await fs.readFile(new URL('./public/plan.json',import.meta.url),'utf8'));
   const saveId=url.searchParams.get('save'),profileId=url.searchParams.get('profile'),share=url.searchParams.get('share')==='1';
   let saves=db.saves.filter(s=>s.userId===u.id);
   if(saveId){saves=saves.filter(s=>s.id===saveId);if(!saves.length)fail('Save not found.',404);}
   if(profileId){saves=saves.filter(s=>s.profiles.some(p=>p.id===profileId));if(!saves.length)fail('Profile not found.',404);}
   const exported=saves.map(s=>{
    const profiles=profileId?s.profiles.filter(p=>p.id===profileId):s.profiles;
    return {id:s.id,name:s.name,activeProfile:profiles.some(p=>p.id===s.activeProfile)?s.activeProfile:profiles[0].id,profiles:profiles.map(p=>({id:p.id,name:p.name,kind:p.kind,plan:p.plan||null,state:share?shareState(p.state):p.state,...(p.kind==='original'?{handbook:p.handbook||handbook}:{})}))};
   });
   return response({format:transferFormat,version:1,exportedAt:new Date().toISOString(),saves:exported});
  }
  if(endpoint==='/api/duplicate-profile'&&req.method==='POST'){
   const b=await body(req);if(!b.saveId||!b.profileId)fail('Choose a profile to copy.');
   const {save,profile}=scope({headers:{'x-save-id':b.saveId,'x-profile-id':b.profileId}},url,u);
   const profileId=id();
   await commit(d=>{const sv=d.saves.find(s=>s.id===save.id&&s.userId===u.id);const source=sv?.profiles.find(p=>p.id===profile.id);if(!source)fail('Profile not found.',404);
    if(sv.profiles.length>=30)fail('You can keep up to 30 profiles per save.');
    sv.profiles.push({...structuredClone(source),id:profileId,name:(source.name+' · copy').slice(0,80)});
    sv.activeProfile=profileId;d.users.find(x=>x.id===u.id).activeSave=sv.id;
   });return response({saveId:save.id,profileId,workspace:summary(db.users.find(x=>x.id===u.id))},201);
  }
  if(endpoint==='/api/import-saves'&&req.method==='POST'){
   const imported=validateTransfer(await body(req));
   await commit(d=>{if(d.saves.filter(s=>s.userId===u.id).length+imported.saves.length>50)fail('Import would exceed the save limit.');for(const save of imported.saves){const old=save.activeProfile;for(const p of save.profiles){const previous=p.id;p.id=id();if(previous===old)save.activeProfile=p.id;}save.id=id();save.userId=u.id;d.saves.push(save);d.users.find(x=>x.id===u.id).activeSave=save.id;}});
   return response(summary(db.users.find(x=>x.id===u.id)));
  }
  if(endpoint==='/api/preview'&&req.method==='POST'){throttle(req);const b=await body(req);return response(calculate(b.settings));}
  if(endpoint==='/api/profiles'&&req.method==='POST'){
   throttle(req);const b=await body(req);const saveName=b.saveId?null:name(b.saveName),profileName=name(b.name);const plan=b.kind==='original'?null:calculate(b.settings);const profileId=id();let saveId=b.saveId||id();
   await commit(d=>{let save=d.saves.find(s=>s.id===saveId&&s.userId===u.id);if(b.saveId&&!save)fail('Save not found.',404);if(!save){if(d.saves.filter(s=>s.userId===u.id).length>=50)fail('You can create up to 50 saves.');save={id:saveId,name:saveName,userId:u.id,activeProfile:profileId,profiles:[]};d.saves.push(save);}if(save.profiles.length>=30)fail('You can keep up to 30 profiles per save.');const state=blank();state.settings.phase=plan?.settings.phase||'3';if(plan)state.factoryGroups=defaultFactoryGroups(plan);save.profiles.push({id:profileId,name:profileName,kind:plan?'calculated':'original',plan,state});save.activeProfile=profileId;d.users.find(x=>x.id===u.id).activeSave=saveId;});return response({saveId,profileId,workspace:summary(db.users.find(x=>x.id===u.id))},201);
  }
  if(endpoint==='/api/select'&&req.method==='POST'){const b=await body(req);const {save,profile}=scope({headers:{'x-save-id':b.saveId,'x-profile-id':b.profileId}},url,u);await commit(d=>{d.users.find(x=>x.id===u.id).activeSave=save.id;d.saves.find(s=>s.id===save.id).activeProfile=profile.id;});return response(summary(db.users.find(x=>x.id===u.id)));}
  if(endpoint==='/api/remove-profile'&&req.method==='POST'){
   const b=await body(req);if(b.confirmed!==true)fail('Confirm profile removal first.');
   if(!b.saveId||!b.profileId)fail('Choose a profile to remove.');
   const {save,profile}=scope({headers:{'x-save-id':b.saveId,'x-profile-id':b.profileId}},url,u);
   await commit(d=>{const sv=d.saves.find(s=>s.id===save.id&&s.userId===u.id);if(!sv||!sv.profiles.some(p=>p.id===profile.id))fail('Profile not found.',404);
    sv.profiles=sv.profiles.filter(p=>p.id!==profile.id);
    if(!sv.profiles.length)d.saves=d.saves.filter(s=>s.id!==sv.id);
    else if(sv.activeProfile===profile.id)sv.activeProfile=sv.profiles[0].id;
    const owner=d.users.find(x=>x.id===u.id);if(!d.saves.some(s=>s.id===owner.activeSave&&s.userId===u.id))owner.activeSave=d.saves.find(s=>s.userId===u.id)?.id||null;
   });return response(summary(db.users.find(x=>x.id===u.id)));
  }
  if(endpoint==='/api/rename'&&req.method==='POST'){const b=await body(req);const title=name(b.name);const {save,profile}=scope(req,url,u);await commit(d=>{const sv=d.saves.find(s=>s.id===save.id);if(b.target==='save')sv.name=title;else if(b.target==='profile')sv.profiles.find(p=>p.id===profile.id).name=title;else fail('Unknown rename target.');});return response(summary(db.users.find(x=>x.id===u.id)));}
  const {save,profile}=scope(req,url,u);
  if(endpoint==='/api/round-up'&&req.method==='POST'){
   if(profile.kind!=='calculated')fail('The preserved handbook is unchanged. Create a calculated profile to use whole-machine planning.');
   if(profile.plan.settings.wholeMachines)fail('This profile already uses whole-machine planning.');
   throttle(req);const rounded=calculate({...profile.plan.settings,wholeMachines:true}),profileId=id();let reviewCount=0;
   await commit(d=>{const sv=d.saves.find(s=>s.id===save.id&&s.userId===u.id);if(sv.profiles.length>=30)fail('Profile limit reached.');const previous=sv.profiles.find(p=>p.id===profile.id);const state=structuredClone(previous.state);
    for(const [ph,stage]of Object.entries(rounded.stages))for(const row of stage.rows||[]){const old=previous.plan.stages[ph]?.rows?.find(r=>r.id===row.id);if(!old||Object.entries(row.inputs).some(([n,q])=>q>(old.inputs[n]||0)+0.001)||row.machines>old.machines){const k='calc-'+ph+'-'+row.id;if(state.checks[k]){state.checks[k]=false;reviewCount++;}}}
    sv.profiles.push({id:profileId,name:(previous.name+' · whole machines').slice(0,80),kind:'calculated',plan:rounded,state});sv.activeProfile=profileId;d.users.find(x=>x.id===u.id).activeSave=sv.id;
   });return response({saveId:save.id,profileId,reviewCount,workspace:summary(db.users.find(x=>x.id===u.id))},201);
  }
  if(endpoint==='/api/context'&&req.method==='GET')return response({save:{id:save.id,name:save.name},profile:{id:profile.id,name:profile.name,kind:profile.kind},state:profile.state,plan:profile.plan||null,handbook:profile.handbook});
  if(endpoint==='/api/state'&&req.method==='GET')return response(profile.state);
  if(endpoint==='/api/export'&&req.method==='GET')return response({format:'satisfactory-planner-backup',exportedAt:new Date().toISOString(),saveName:save.name,profileName:profile.name,profileId:profile.id,state:profile.state},200,{'Content-Disposition':'attachment; filename="satisfactory-progress.json"'});
  if(['/api/update','/api/import'].includes(endpoint)&&req.method==='POST'){
   const b=await body(req);let imported;if(endpoint==='/api/import'){if(b.format&&b.format!=='satisfactory-planner-backup')fail('Wrong backup format.');if(b.profileId&&b.profileId!==profile.id)fail('This backup belongs to another profile. Switch to that profile before restoring.');imported=validateState(b.format?b.state:b);}
   const next=await commit(d=>{const p=d.saves.find(s=>s.id===save.id&&s.userId===u.id)?.profiles.find(p=>p.id===profile.id);if(!p)fail('Profile not found.',404);const state=imported||mutate(p.state,b);if(p.kind==='original'&&!['3','4','5','post'].includes(state.settings.phase))fail('The original handbook covers Phase 3 onward.');state.revision=p.state.revision+1;p.state=state;return state;});return response(next);
  }
  return response({error:'Not found.'},404);
 };
}
