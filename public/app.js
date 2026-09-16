import {browserMode,browserRequest} from './browser-api.js';
import {droneFuels,storageOptions,distributions,purities,powerOptions,resourceDefaults,helpText} from './preferences.js';
import {progression} from './progression.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});
const num3=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:3});
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
let progressionData;
let workspace,currentSave,currentProfile,calculated=null,wizard=null,authMode='login';
let basePlan,plan,state,view='plan',query='',floor='ground',factoryFilter='all',activeDetail=null,pending=0,toastTimer,layoutEditing=false,planEditing=false,editingTask=null,factoryEditing=false;
const phase=()=>state.settings.phase;
const stage=()=>phase()==='post'?'5':phase();
const checked=id=>!!state.checks[id];
const doneAttr=id=>checked(id)?'checked':'';
const phaseLabel=p=>p==='post'?'Post Phase 5':'Phase '+p;
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.className='show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',error?9000:3500);}
async function request(path,options={}){if(browserMode&&path.startsWith('/api/'))return browserRequest(path,options);const r=await fetch(browserMode?new URL('.'+path,import.meta.url):path,{cache:'no-store',...options});let data;try{data=await r.json();}catch{throw new Error('The server returned an unreadable response.');}if(!r.ok)throw new Error(data.error||'Request failed.');return data;}
let writeQueue=Promise.resolve();
function save(op){
 const scope={...scopeHeaders()};
 pending++;saveIndicator();
 const run=writeQueue.then(async()=>{const next=await request('/api/update',{method:'POST',headers:{'Content-Type':'application/json','X-Planner-Request':'1',...scope},body:JSON.stringify(op)});if(scope['X-Save-Id']===currentSave.id&&scope['X-Profile-Id']===currentProfile.id)state=next;return next;});
 writeQueue=run.catch(()=>{});
 return run.catch(e=>{toast(e.message,true);throw e;}).finally(()=>{pending--;saveIndicator();});
}
function saveIndicator(){const el=$('#saved');if(el)el.textContent=pending?'Saving…':browserMode?'Saved in this browser':'Saved on server';}
function taskEditsState(){const e=state?.taskEdits||{};return {order:e.order||{},removed:e.removed||[],titles:e.titles||{},bodies:e.bodies||{},links:e.links||{}};}
function applyTaskEdits(base){
 const e=taskEditsState(),removed=new Set(e.removed);
 const visible=base.filter(t=>!removed.has(t.id)).map(t=>({...t,title:e.titles[t.id]||t.title,body:e.bodies[t.id]||t.body}));
 const ord=e.order[phase()];
 if(!ord?.length)return visible;
 const pos=new Map(ord.map((id,i)=>[id,i]));
 return [...visible.filter(t=>pos.has(t.id)).sort((a,b)=>pos.get(a.id)-pos.get(b.id)),...visible.filter(t=>!pos.has(t.id))];
}
function basePlanTasks(){return calculated?[...calcTasks(),...state.customTasks.filter(t=>t.phase===phase())]:tasks();}
function planTasks(){return applyTaskEdits(basePlanTasks());}
const autoTaskLink=id=>id.match(/^calc-(?:[1-5]|post)-(.+)$/)?.[1]||'';
function taskLinkHtml(t){
 const linked=taskEditsState().links[t.id]||autoTaskLink(t.id);
 if(!linked)return '';
 if(calculated){const row=(calcStage().rows||[]).find(r=>r.id===linked);return row?`<button class="btn quiet task-link" data-calc-factory="${row.id}">Open factory: ${esc(row.name)} ↗</button>`:'';}
 const f=plan.factories.find(x=>x.id===linked&&x.stages[stage()]);
 return f?`<button class="btn quiet task-link" data-factory="${f.id}">Open factory: ${esc(f.name)} ↗</button>`:'';
}
function taskEditForm(t){
 const options=calculated?(calcStage().rows||[]).map(r=>[r.id,r.name]):plan.factories.filter(f=>f.stages[stage()]).map(f=>[f.id,f.name]);
 const current=taskEditsState().links[t.id]||autoTaskLink(t.id);
 return `<form class="task task-edit" data-task-edit="${t.id}"><label class="field">Step title<input name="title" maxlength="240" required value="${esc(t.title)}"></label><label class="field">Details<textarea name="body" class="notes" maxlength="6000">${esc(t.body||'')}</textarea></label><label class="field">Linked factory<select name="link"><option value="">No linked factory</option>${options.map(([v,l])=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(l)}</option>`).join('')}</select></label><div class="task-edit-actions"><button class="btn primary" type="submit">Save step</button> <button class="btn" type="button" data-cancel-task-edit>Cancel</button></div><p class="small muted">Restore the original text by clearing a field. The step keeps its checkmark either way.</p></form>`;
}
function taskHtml(t){
 if(planEditing&&editingTask===t.id)return taskEditForm(t);
 const tools=planEditing?`<span class="task-tools"><button class="btn quiet" data-move-task="${t.id}" data-dir="-1" aria-label="Move up: ${esc(t.title)}">↑</button><button class="btn quiet" data-move-task="${t.id}" data-dir="1" aria-label="Move down: ${esc(t.title)}">↓</button><button class="btn quiet" data-edit-task="${t.id}">Edit</button><button class="btn quiet danger" data-remove-step="${t.id}">Remove</button></span>`:'';
 return `<article class="task ${planEditing?'is-editing':''}"><input type="checkbox" data-check="${t.id}" aria-label="Complete: ${esc(t.title)}" ${doneAttr(t.id)}><details data-task="${t.id}"><summary>${esc(t.title)}</summary><p>${esc(t.body||'Your own task for this phase.')}</p>${taskLinkHtml(t)}${t.id.startsWith('custom-')&&!planEditing?`<button class="delete-task" data-remove="${t.id}">Delete personal task</button>`:''}</details>${tools}</article>`;
}
function planEditToolbar(){return `<button class="btn ${planEditing?'primary':''}" data-toggle-plan-edit>${planEditing?'Done editing':'Edit steps'}</button>`;}
function removedStepsHtml(){
 if(!planEditing)return '';
 const removed=new Set(taskEditsState().removed);
 const list=basePlanTasks().filter(t=>removed.has(t.id));
 if(!list.length)return '';
 return `<details class="panel removed-steps"><summary>Removed steps in this phase (${list.length})</summary>${list.map(t=>`<div class="removed-step"><span>${esc(t.title)}</span><button class="btn quiet" data-restore-task="${t.id}">Restore</button></div>`).join('')}</details>`;
}
function stat(label,value,caption){return `<div class="stat"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${caption}</small></div>`;}
function tasks(){return [...plan.phases[phase()],...state.customTasks.filter(t=>t.phase===phase())];}
function header(eyebrow,title,subtitle='',badge=''){return `<div class="heading-row"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${subtitle?`<div class="subtitle">${subtitle}</div>`:''}</div>${badge?`<span class="badge orange">${badge}</span>`:''}</div>`;}
function profileFooter(){
 if(calculated){const s=calculated.settings;const date=new Date(calculated.createdAt);return `${esc(currentProfile.name)}<br>${esc(purities.find(([id])=>id===s.purity)?.[1]||s.purity)} purity · ${num(s.multiplier)}× elevator parts<br>${num(s.powerFactor)}× power consumption${Number.isNaN(date.getTime())?'':'<br>Plan created '+esc(date.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}))}`;}
 if(currentProfile?.kind==='original')return `${esc(currentProfile.name)}<br>Pure nodes · 50× elevator parts<br>Half power consumption<br>Plan revised 13 September 2026`;
 return 'Create or select a profile';
}
const shell=()=>`<div class="layout"><aside class="sidebar"><div class="brand"><img src="./favicon.svg" alt=""><div>Project Assembly<div class="eyebrow">FICSIT compliance terminal</div></div></div><nav class="nav" aria-label="Main navigation">${[['plan','◫','Build plan'],['factories','▥','Factories'],['storage','▦','Storage room'],['resources','↗','Power & resources'],['backup','⇅','Backup & notes']].map(([id,icon,label])=>`<a href="#${id}" class="${view===id?'active':''}" ${view===id?'aria-current="page"':''}><span class="navicon" aria-hidden="true">${icon}</span>${label}</a>`).join('')}</nav><div class="save-status"><span class="dot"></span><span id="saved">${browserMode?'Saved in this browser':'Saved on server'}</span></div><div class="sidebar-foot">${profileFooter()}</div></aside><div><header class="topbar"><div class="breadcrumbs"><a href="#profiles">${esc(currentSave.name)}</a> <span aria-hidden="true"> / </span> ${phaseLabel(phase())}</div><label class="small">Working on <select id="phase-picker" aria-label="Working phase" ${!currentSave.id?'disabled':''}>${(calculated||!currentSave.id?['1','2','3','4','5','post']:['3','4','5','post']).map(p=>`<option value="${p}" ${phase()===p?'selected':''}>${phaseLabel(p)}</option>`).join('')}</select></label></header><main id="main" class="workspace" tabindex="-1"></main></div></div>`;
function render(){
 const open=[...document.querySelectorAll('details[open][data-task]')].map(x=>x.dataset.task);
 const focused=document.activeElement?.id;const selection=document.activeElement?.selectionStart;
 $('#app').innerHTML=shell();
 const routes={profiles:renderProfiles,wizard:renderWizard,account:renderAccount,plan:calculated?renderCalculatedPlan:renderPlan,factories:calculated?renderCalculatedFactories:renderFactories,storage:renderStorage,resources:calculated?renderCalculatedResources:renderResources,backup:renderBackup};
 $('#main').innerHTML=routes[view]();
 open.forEach(id=>document.querySelector(`details[data-task="${id}"]`)?.setAttribute('open',''));
 if(focused&&document.getElementById(focused)){const e=document.getElementById(focused);e.focus({preventScroll:true});if(typeof selection==='number'&&e.setSelectionRange)e.setSelectionRange(selection,selection);}
 saveIndicator();
}
function renderPlan(){
 const ts=planTasks(),done=ts.filter(t=>checked(t.id)).length,next=ts.find(t=>!checked(t.id)),pct=ts.length?Math.round(done/ts.length*100):100;
 const fs=plan.factories.filter(f=>f.stages[stage()]);const built=fs.filter(f=>checked('factory-'+stage()+'-'+f.id)).length;
 const slots=storageBays().flatMap(b=>b.items).filter(x=>x.name),ready=slots.filter(x=>checked('slot-'+x.id+'-verified')).length;
 return header('THE NEXT BUILD',phaseLabel(phase())+' field plan',phase()==='post'?'Storage first. Keep the network running, then finish the remaining items.':'Build the supply chain in order. Check off each step when it is verified in your save.','YOUR SAVE · YOUR PACE')+
 `<div class="stats">${stat('Phase checklist',done+' <span class="fraction">/ '+ts.length+'</span>','Steps completed')}${stat('Factory targets',built+' <span class="fraction">/ '+fs.length+'</span>','Marked running at this phase')}${stat('Storage ready',ready+' <span class="fraction">/ '+slots.length+'</span>','Item positions verified')}${stat('Planned power',num(plan.power[stage()])+' <span class="fraction">GW</span>','Gross capacity at this stage')}</div>
 <div class="split"><section><div class="section-head"><h2>Build sequence</h2><span class="head-tools"><span class="small muted">${pct}% complete</span> ${planEditToolbar()}</span></div><div class="progress-track"><span style="width:${pct}%"></span></div><div class="checklist">${ts.map(taskHtml).join('')||'<div class="empty-state">Every step of this phase is removed. Use Removed steps below to restore them.</div>'}</div>${removedStepsHtml()}<form id="add-task" class="inline-form"><input name="title" maxlength="240" required placeholder="Add a task for this phase…" aria-label="Personal task"><button class="btn" type="submit">Add task</button></form>
 <section class="panel"><h2>Phase notes</h2><p class="small muted">Locations, train routes, things to check on your next session.</p><textarea id="phase-note" class="notes" maxlength="6000" aria-label="Phase notes">${esc(state.notes['phase-'+phase()]||'')}</textarea><div class="note-save"><span class="small muted">Saved only when you click Save notes.</span><button class="btn" data-save-note="phase-${phase()}" data-input="phase-note">Save notes</button></div></section></section>
 <aside class="side-panels"><section class="panel next-card"><div class="step-no">${next?'NEXT UNFINISHED STEP':'PHASE CHECKLIST COMPLETE'}</div><h2>${esc(next?.title||'Ready for the next phase')}</h2><p>${esc(next?.body||'Verify the delivery, then choose your next phase using the selector above.')}</p><a class="btn primary full" href="#factories">Open factory targets →</a></section>
 <section class="panel"><h2>${phase()==='post'?'Post-game priority':'Elevator delivery'}</h2>${phase()==='post'?'<p>Protect the storage allowances. Reduce former elevator exports when the new completion factories need those resources. Sink the remaining surplus.</p><a class="btn" href="#factories">Completion modules →</a>':plan.deliveries.filter(d=>d.phase===phase()).map(deliveryHtml).join('')}</section>
 <section class="panel accent"><h3>Keep the corrections together</h3><p class="small">Resource conversion is included. The old coal and temporary fuel plants retire; 44.425 GW of turbofuel stays. Storage includes collectables Q/R and the workshop underneath.</p><a class="btn quiet" href="#resources">Review the resource gate →</a></section></aside></div>`;
}
function deliveryHtml(d){const v=state.deliveries[d.id]??(currentProfile.id==='original'?d.initial:0);return `<div class="delivery"><label for="delivery-${d.id}">${esc(d.name)}</label><div><input id="delivery-${d.id}" data-delivery="${d.id}" type="number" min="0" max="${d.target}" step="1" value="${v}"><small>/ ${num(d.target)}</small></div><div class="progress-track"><span style="width:${Math.min(100,v/d.target*100)}%"></span></div><span class="small muted">${d.rate?`${num(d.rate)}/min net · ${num(Math.max(0,d.target-v)/d.rate)} minutes remaining`:'Phase 3 delivery already complete'}</span></div>`;}
const siteOf=f=>['Plastic','Rubber'].includes(f.name)?'oil':f.nuclear?'nuclear':null;
function factoryGroupsState(){const g=state?.factoryGroups||{};return {groups:g.groups||[],assignments:g.assignments||{}};}
const membershipsOf=key=>factoryGroupsState().assignments[key]||[];
function allocationHtml(key,groupId,total,machines,unit='/min'){
 const ms=membershipsOf(key),m=ms.find(x=>x.group===groupId);
 if(!m||(ms.length===1&&m.rate==null))return '';
 const rate=m.rate==null?Math.max(0,total-ms.reduce((a,x)=>a+(x.rate||0),0)):m.rate;
 const share=total>0?Math.min(1,rate/total):0;
 return `<div class="small allocation">${m.rate==null?'Remaining here: ':'Here: '}${num(rate)}${unit} of ${num(total)}${unit}${machines&&share<1?` · ≈ ${num(machines*share)} of ${num(machines)} machines`:''}</div>`;
}
function assignEditor(key){
 const g=factoryGroupsState();
 if(!g.groups.length)return '<p class="small muted">Create a group above to place this factory.</p>';
 const ms=membershipsOf(key);
 const avail=g.groups.filter(gr=>!ms.some(m=>m.group===gr.id));
 return `<div class="assign-editor">${ms.map(m=>`<div class="assign-row"><span>${esc(g.groups.find(x=>x.id===m.group)?.name||'')}</span><input type="number" min="0" step="any" data-assign-rate="${key}" data-group="${m.group}" placeholder="all / remainder" value="${m.rate??''}" aria-label="Production per minute in ${esc(g.groups.find(x=>x.id===m.group)?.name||'this group')}"><button class="btn quiet danger" data-unassign="${key}" data-group="${m.group}" aria-label="Remove from ${esc(g.groups.find(x=>x.id===m.group)?.name||'group')}">✕</button></div>`).join('')}${avail.length&&ms.length<12?`<select data-assign-add="${key}" aria-label="Add to a group"><option value="">+ Add to group…</option>${avail.map(gr=>`<option value="${gr.id}">${esc(gr.name)}</option>`).join('')}</select>`:''}</div>`;
}
function groupEditPanel(){return `<section class="panel edit-panel"><h2>Factory groups</h2><form id="add-group" class="inline-form"><input id="new-group-name" name="name" maxlength="80" required placeholder="New group (e.g. Cable factory)…" aria-label="New group name"><button class="btn primary" type="submit">+ Add group</button></form><p class="small muted">Group production into the physical sites of your world. A factory can join several groups with a production split — for example Wire: 300/min at the cable factory and the remainder beside stitched plates. Leave the rate empty for the whole output or the remainder. Removing a group keeps every factory and its progress.</p></section>`;}
function groupSections(list,keyOf,cardFn){
 return factoryGroupsState().groups.map(gr=>{
  const members=list.filter(x=>membershipsOf(keyOf(x)).some(m=>m.group===gr.id));
  if(!members.length&&!factoryEditing)return '';
  return `<section class="site-group user-group"><header class="site-head"><div><span class="eyebrow">FACTORY GROUP · ${members.length} ${members.length===1?'FACTORY':'FACTORIES'}</span>${factoryEditing?`<input class="bay-rename" data-group-rename="${gr.id}" value="${esc(gr.name)}" maxlength="80" aria-label="Rename group ${esc(gr.name)}">`:`<h2>${esc(gr.name)}</h2>`}</div>${factoryEditing?`<button class="btn danger" data-remove-group="${gr.id}">Remove group</button>`:members.length>1?`<button class="btn" data-group-chain="${gr.id}">Build order ↗</button>`:''}</header><div class="cards">${members.map(x=>cardFn(x,gr.id)).join('')||'<div class="empty-state">Empty group. Add factories with the group selector on their cards.</div>'}</div></section>`;
 }).join('');
}
function factoryEditToolbar(){return `<button class="btn ${factoryEditing?'primary':''}" data-toggle-factory-edit>${factoryEditing?'Done editing':'Edit groups'}</button>`;}
function factoryCard(f,groupId=null){
 const r=f.stages[stage()],id='factory-'+stage()+'-'+f.id;
 return `<article class="factory-card ${checked(id)?'done':''}"><div class="card-top"><span class="card-icon">${itemIcon(f.name)}</span><div class="card-main"><button class="name" data-factory="${f.id}">${esc(f.name)}</button><div class="output">${num(r.output)} <span>/min</span></div></div>${f.local?'<span class="badge">Local</span>':f.conversion?'<span class="badge orange">Convert</span>':''}</div><div class="recipe">${esc(r.recipe.replace('Alternate: ',''))}</div><div class="small">${r.machines?`${num(r.machines)} × ${esc(r.machine)}`:'See shared oil campus'} <span class="muted">· storage ${num(r.storage)}/min</span></div>${groupId?allocationHtml(f.id,groupId,r.output,r.machines):''}<footer><label class="check-row"><input type="checkbox" data-check="${id}" ${doneAttr(id)}>Running</label><button class="btn quiet" data-factory="${f.id}">Details ↗</button></footer>${factoryEditing?assignEditor(f.id):''}</article>`;
}
function siteGroupHtml(site,members){
 if(!members.length)return '';
 const p=plan.plans[stage()];
 const label=site==='oil'?'Oil campus':'Nuclear site';
 const sub=site==='oil'?`One shared machine set produces these outputs together: ${num(p.oil.reduce((a,x)=>a+x.machines,0))} buildings · crude ${num(p.oilTotals.crude)}/min · water ${num(p.oilTotals.water)}/min. Open a card for the shared recipe table.`:'Build and balance this radioactive chain as one site at the power plants. Process buffers stay here; the general storage surplus does not apply.';
 return `<section class="site-group"><header class="site-head"><div><span class="eyebrow">SHARED SITE · ${members.length} OUTPUTS</span><h2>${label}</h2></div><p class="small muted">${sub}</p></header><div class="cards">${members.map(f=>factoryCard(f)).join('')}</div></section>`;
}
function renderFactories(){
 const list=plan.factories.filter(f=>f.stages[stage()]).filter(f=>(f.name+' '+f.stages[stage()].recipe).toLowerCase().includes(query.toLowerCase())).filter(f=>factoryFilter==='all'||(factoryFilter==='todo'&&!checked('factory-'+stage()+'-'+f.id))||(factoryFilter==='done'&&checked('factory-'+stage()+'-'+f.id))||(factoryFilter==='local'&&f.local));
 const ungrouped=list.filter(f=>!membershipsOf(f.id).length);
 const singles=ungrouped.filter(f=>!siteOf(f)),oil=ungrouped.filter(f=>siteOf(f)==='oil'),nuclear=ungrouped.filter(f=>siteOf(f)==='nuclear');
 const groupsHtml=groupSections(list,f=>f.id,(f,gid)=>factoryCard(f,gid));
 return header('PRODUCTION LIBRARY','Factory targets','Outputs include downstream supply, protected storage and elevator exports. Click a factory for its inputs and expansion history.')+
 `${phase()==='post'?'<div class="notice">These are retained Phase 5 capacities, not mandatory post-game output rates. Give new storage items priority before committing all spare output to sinks.</div>':''}
 <div class="toolbar"><input id="factory-search" class="search" placeholder="Find a part or recipe…" aria-label="Find a factory" value="${esc(query)}"><select id="factory-filter" aria-label="Factory status">${[['all','All factories'],['todo','Not running yet'],['done','Running'],['local','Made beside consumers']].map(([v,l])=>`<option value="${v}" ${factoryFilter===v?'selected':''}>${l}</option>`).join('')}</select><span class="small muted">${list.length} targets</span>${factoryEditToolbar()}</div>
 ${factoryEditing?groupEditPanel():''}
 ${groupsHtml}
 ${siteGroupHtml('oil',oil)}${siteGroupHtml('nuclear',nuclear)}
 ${(groupsHtml||oil.length||nuclear.length)&&singles.length?'<p class="eyebrow">UNGROUPED FACTORIES</p>':''}<div class="cards">${singles.map(f=>factoryCard(f)).join('')||(list.length?'':'<div class="empty-state">No factories match this filter.</div>')}</div>
 ${phase()==='post'?`<section style="margin-top:32px"><h2>Additional completion modules</h2><div class="notice">These recipe inputs are additional to the main resource budget. Allocate their supply first. Gathered feedstock and byproducts still need handling.</div><div class="completion-grid">${plan.completion.filter(r=>r.name.toLowerCase().includes(query.toLowerCase())).map(r=>`<article class="completion-item"><label class="check-row"><input type="checkbox" data-check="completion-${r.id}" ${doneAttr('completion-'+r.id)}><strong>${esc(r.name)}</strong></label><p>${num(r.output)}/min · ${num(r.machines)} ${esc(r.machine)} · last at ${num(r.lastClock)}%<br>${esc(r.recipe)}</p><p><b>Inputs:</b> ${inputText(r.inputs)}${Object.keys(r.byproducts).length?`<br><b>Byproducts:</b> ${inputText(r.byproducts)}`:''}</p></article>`).join('')}</div></section>`:''}`;
}
function inputText(inputs){return Object.entries(inputs).map(([n,q])=>esc(n)+' '+num(q)+'/min').join(' · ');}
function storageEdits(){const e=state?.storageEdits||{};return {floors:e.floors||[],floorNames:e.floorNames||{},bays:e.bays||[],bayNames:e.bayNames||{},slots:e.slots||{},clearedSlots:e.clearedSlots||[]};}
function storageFloors(){const e=storageEdits();return [...[['ground','Ground floor'],['upper','Upper floor'],['workshop','Workshop']].map(([id,label])=>({id,label:e.floorNames[id]||label,builtin:true})),...e.floors.map(f=>({id:f.id,label:e.floorNames[f.id]||f.label,builtin:false}))];}
function nextBayLetter(){
 const used=new Set([...plan.storage.map(b=>b.id),...storageEdits().bays.map(b=>b.id)]);
 for(const l of 'STUVXYZABCDEFGHIJKLMNOPQRW')if(!used.has(l))return l;
 for(const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')for(const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')if(!used.has(a+b))return a+b;
 return null;
}
function storageBays(){
 const e=storageEdits(),cleared=new Set(e.clearedSlots);
 const selected=calculated?new Set(Object.values(calculated.stages).flatMap(p=>Object.keys(p.storage||{}))):null;
 const keepCollectables=calculated?(calculated.settings.collectables??(calculated.settings.storage==='all')):true;
 const merge=(baseName,id)=>cleared.has(id)?null:(e.slots[id]??baseName);
 const base=plan.storage.map(b=>({...b,name:e.bayNames[b.id]||b.name,items:b.items.map(x=>{
  const planned=selected?(x.name&&(selected.has(x.name)||(['Q','R'].includes(b.id)&&keepCollectables))?x.name:null):x.name;
  return {...x,name:merge(planned,x.id)};
 })}));
 const custom=e.bays.map(b=>({id:b.id,name:e.bayNames[b.id]||b.name,floor:b.floor,custom:true,items:Array.from({length:8},(_,i)=>{const id=b.id+String(i+1).padStart(2,'0');return {id,name:merge(null,id)};})}));
 return [...base,...custom].filter(b=>b.custom||!selected||b.items.some(x=>x.name));
}
const slotChecks=["built","labelled","connected","verified"];
const slotKeys=id=>slotChecks.map(k=>"slot-"+id+"-"+k);
const slotDone=id=>slotKeys(id).every(checked);
function renderStorage(){
 const floors=storageFloors();
 if(!floors.some(f=>f.id===floor))floor=floors[0].id;
 const current=floors.find(f=>f.id===floor);
 const bays=storageBays();
 const floorBays=bays.filter(b=>b.floor===floor),display=floorBays.filter(b=>!query||b.items.some(x=>x.name&&(x.id+' '+x.name).toLowerCase().includes(query.toLowerCase())));
 const ordered=[...display].sort((a,b)=>Math.floor((b.id.charCodeAt(0)-65)/2)-Math.floor((a.id.charCodeAt(0)-65)/2)||a.id.localeCompare(b.id));
 const floorTabs=`<div class="tabs">${floors.map(f=>`<button class="tab ${floor===f.id?'active':''}" data-floor="${f.id}">${esc(f.label)}</button>`).join('')}</div>`;
 const editPanel=layoutEditing?`<section class="panel edit-panel"><h2>Storage layout</h2><div class="edit-grid">
  <form id="add-bay" class="inline-form"><input id="new-bay-name" name="name" maxlength="80" required placeholder="New bay on this floor…" aria-label="New bay name"><button class="btn primary" type="submit">+ Add bay</button></form>
  <form id="add-floor" class="inline-form"><input id="new-floor-name" name="name" maxlength="80" required placeholder="New floor (e.g. Basement overflow)" aria-label="New floor name"><button class="btn" type="submit">Add floor</button></form>
  <form id="rename-floor" class="inline-form"><input id="floor-rename-input" name="name" maxlength="80" required placeholder="Rename this floor…" aria-label="Rename this floor"><button class="btn" type="submit">Rename floor</button></form>
  ${current.builtin?'':`<button class="btn danger" data-remove-floor="${current.id}" ${floorBays.length?'disabled':''}>${floorBays.length?'Remove its bays first':'Remove this floor'}</button>`}
 </div><p class="small muted">Handbook bays and their addresses stay put: rename them or fill reserved positions. Added bays get the next free letter so container addresses and progress stay stable. Removing a container keeps its saved checkmarks.</p></section>`:'';
 const notice=floor==='ground'?(currentProfile.id!=='original'?'<div class="notice blue">Optional storage template. Each position has its own checklist; nothing is assumed built.</div>':'<div class="notice blue"><b>Ground floor is built.</b> The shell is marked complete. Move Gas Filters G08 → H02 and Nobelisks H02 → H08; assign Medicinal Inhalers to G08. H01 stays Iodine-Infused Filter.</div>'):floor==='upper'?'<div class="notice blue">Q sits behind O; R sits behind P. Packaged fluids only. Nuclear items and unpackaged fluids stay outside this room.</div>':'';
 const bayArea=`${notice}
 ${query?'<p class="small muted">Filtered view: showing matching bays only. Clear search to see the full floor arrangement.</p>':''}${ordered.length?'<p class="eyebrow">REAR OF HALL ↑</p>':''}<div class="floor-grid">${ordered.map((b,i)=>`${i%2===1?'<div class="aisle">MAIN AISLE</div>':''}${bayHtml(b)}`).join('')||(floor==='workshop'?'':`<div class="empty-state">${floorBays.length?'No matching item on this floor. Try another floor.':'No bays on this floor yet. Use Edit layout to add one.'}</div>`)}</div>${ordered.length?'<div class="entry">↓ ENTRANCE / STAIRS</div><div class="small muted">Within each bay, 01–04 are the rear bank; 05–08 are the front bank. Read left to right on both banks. Grey positions remain unassigned.</div>':''}`;
 return header('ONE ITEM · ONE ADDRESS','Storage room',calculated?'Showing your selected storage supply across all phases. Unselected positions are reserved; addresses stay stable.':'Mark containers Done here, or complete a room after placing, labelling, connecting and checking its containers. Click an item for details. Positions match your printed storage plan.')+
 `<div class="toolbar">${floorTabs}<input id="storage-search" class="search" aria-label="Find storage on this floor" placeholder="Find an item or address on this floor…" value="${esc(query)}"><button class="btn ${layoutEditing?'primary':''}" data-toggle-layout>${layoutEditing?'Done editing':'Edit layout'}</button></div>`+
 editPanel+(floor==='workshop'?renderWorkshop():'')+bayArea+
 `<section style="margin-top:28px"><h2>Storage build checklist</h2><div class="checklist">${(calculated?[{id:'calc-storage-layout',title:'Build and label the selected storage positions',body:'Use one container per selected item. Reserve its refill supply and route sinkable overflow to the AWESOME Sink; gathered items need manual replenishment.'}]:plan.storageTasks).map(taskHtml).join('')}</div></section>`;
}
function bayHtml(b){
 const items=b.items.filter(x=>x.name),done=items.filter(x=>slotDone(x.id)).length;
 const title=layoutEditing?`<input id="bay-name-${b.id}" class="bay-rename" data-bay-rename="${b.id}" value="${esc(b.name)}" maxlength="80" aria-label="Rename bay ${b.id}">`:`<h3>${esc(b.name)}</h3>`;
 const removeBay=layoutEditing&&b.custom?`<button class="btn danger" data-remove-bay="${b.id}">Remove bay</button>`:'';
 const addContainer=layoutEditing&&items.length<b.items.length?`<form class="inline-form add-container" data-bay="${b.id}"><input id="bay-draft-${b.id}" name="name" maxlength="120" required placeholder="Add container: item name…" aria-label="Add container to bay ${b.id}"><button class="btn" type="submit">+ Add</button></form>`:'';
 return `<section class="bay"><header class="bay-head"><span class="bay-letter">${b.id}</span>${title}</header><div class="bay-actions"><span class="small muted">${done}/${items.length} containers done</span><span>${removeBay} <button class="btn quiet" data-complete-bay="${b.id}" ${!items.length||done===items.length?'disabled':''}>Complete room ${b.id}</button></span></div><div class="bay-items">${b.items.map((x,i)=>`${i===4?'<div class="walkway">BAY WALKWAY</div>':''}${x.name?`<div class="slot ${slotDone(x.id)?'done':''} ${query&&(x.id+' '+x.name).toLowerCase().includes(query.toLowerCase())?'match':''}">${layoutEditing?`<button class="slot-remove" data-clear-slot="${x.id}" aria-label="Clear container ${x.id}: ${esc(x.name)}">✕</button>`:''}<button class="slot-details" data-slot="${x.id}" aria-label="${x.id}: ${esc(x.name)}"><strong>${x.id}</strong><img class="item-icon" src="./icons/${slug(x.name)}.png" width="48" height="48" loading="lazy" alt=""><span>${esc(x.name)}</span></button><label class="slot-complete"><input type="checkbox" data-complete-slot="${x.id}" aria-label="Complete ${x.id}: ${esc(x.name)}" ${slotDone(x.id)?'checked':''}>Done</label></div>`:`<div class="slot empty"><strong>${x.id}</strong><span>Reserved</span></div>`}`).join('')}</div>${addContainer}</section>`;
}
function renderWorkshop(){const items=[['bench','Craft Bench and Equipment Workshop','Side by side near the entrance.'],['tools','Tools and mobility equipment','Personal boxes on the left wall.'],['weapons','Weapons and spare wearables','Personal boxes on the right wall. Ammo and filters stay in G/H.'],['mam','MAM and inventory drop','Rear wall, with collected items routed to Q/R. Finish the sorter at a recovery chest.']];return `<div class="panel"><span class="eyebrow">GROUND-FLOOR REAR EXTENSION</span><h2 style="margin-top:10px">Workshop beneath Q/R</h2><p>The upper floor gets the new storage bays; the space underneath becomes your crafting area. No existing production-container addresses change.</p><div class="checklist">${items.map(([id,title,body])=>taskHtml({id:'workshop-'+id,title,body})).join('')}</div></div>`;}
function renderResources(){const raw=plan.resources[stage()],p=plan.plans[stage()];return header('CAPACITY BEFORE CONSTRUCTION','Power & resources','These are planned full-stage requirements, not live readings from your save. Mining totals already include retained turbofuel, trucks and all new power.')+
 `<div class="stats">${stat('Gross generation',num(plan.power[stage()])+' GW','At this stage’s completion')}${stat('Production peak',num(p.manufacturingPeakGW)+' GW','Before the utility allowance')}${stat('Production average',num(p.manufacturingAvgGW)+' GW','Half-consumption setting')}${stat('Coal remaining',num(74400-raw.Coal)+'/min','Against all-pure mining limit')}</div>
 <div class="notice">Verify your randomized nitrogen wells can supply <b>${num(raw['Nitrogen Gas']||0)}/min</b> at this stage. The all-pure resource limits assume fully developed extraction and logistics. Additional completion modules are not included.</div>
 <div class="table-wrap"><table><thead><tr><th>Fresh resource</th><th>Required /min</th><th>Available /min</th><th>Remaining /min</th><th>Use</th></tr></thead><tbody>${Object.entries(raw).sort(([a],[b])=>a.localeCompare(b)).map(([n,q])=>{const cap=plan.capacities[n],fraction=cap?q/cap:0;return `<tr><td>${esc(n)}</td><td class="number">${num(q)}</td><td class="number">${cap?num(cap):n==='Water'?'Extraction limited':'Verify wells'}</td><td class="number ${cap&&fraction>.9?'warn':''}">${cap?num(cap-q):'—'}</td><td>${cap?`${num(fraction*100)}%<div class="resource-bar ${fraction>.9?'tight':''}"><span style="width:${Math.min(100,fraction*100)}%"></span></div>`:'—'}</td></tr>`;}).join('')}</tbody></table></div><p class="small muted">Crude availability counts 30 ordinary pure nodes; oil wells are additional. Water includes a 2,000/min reserve for retained turbofuel and resin processing.</p>
 <div class="backup-grid" style="margin-top:24px"><section class="panel"><h2>Power commissioning</h2><div class="checklist">${[['power-retained','Retained turbofuel: 44.425 GW'],['power-rocket-1','Rocket-fuel block 1: +72 GW'],['power-rocket-2','Rocket-fuel block 2: +72 GW'],['power-u4','Phase 4 uranium: +125 GW'],...Array.from({length:4},(_,i)=>['power-rocket-'+(i+3),'Rocket-fuel block '+(i+3)+': +72 GW']),['power-nuclear-final','Complete nuclear fleet: 437.5 GW total']].map(([id,title])=>`<label class="check-row"><input type="checkbox" data-check="${id}" ${doneAttr(id)}>${title}</label>`).join('')}</div></section>
 <section class="panel"><h2>One 72 GW rocket-fuel block</h2><p><b>Inputs/min:</b> 300 Crude, 800 Sulfur, 400 Coal, 600 Nitrogen and 1,000 Water.</p><p>10 Heavy Oil Residue refineries → 8 Diluted Fuel blenders → 8 Nitro Rocket Fuel blenders. Add 5 Residual Rubber refineries and 288 Fuel Generators at 100%.</p><p class="small muted">Produces 1,200 Rocket Fuel, 200 Compacted Coal and 100 Rubber/min. These byproducts are not credited against other factory contracts.</p><div class="notice blue">At Phase 5: (579.231 × 1.2 + 20) ÷ 0.8 ≈ <b>894 GW</b> preliminary requirement. Planned gross capacity: <b>913.925 GW</b>. Replace the 20 GW existing-load allowance with your measured load.</div></section></div>
 <section class="panel" style="margin-top:24px"><h2>Nuclear sequence</h2><p>Phase 4: 50 uranium reactors generate 500 waste/min. Process it into 2.5 Plutonium Fuel Rods/min and sink those rods.</p><p>Phase 5: 100 uranium reactors → 1,000 Uranium Waste/min → 5 Plutonium Fuel Rods/min → 50 plutonium reactors → 50 Plutonium Waste/min → 25 Ficsonium Fuel Rods/min → 25 Ficsonium reactors.</p><p class="small muted">Build downstream processing and burning capacity first. Final reactor cooling needs 42,000 Water/min, already included in the resource table. Keep radioactive buffers at the nuclear site.</p></section>`;}
function renderBackup(){if(browserMode)return renderBrowserBackup();if(calculated)return renderCalculatedBackup();return portablePanel()+header('YOUR PROGRESS','Backup & notes','Progress is stored on the server, so the same Docker instance works across your devices.')+`<div class="backup-grid"><section class="panel"><h2>Download a backup</h2><p>Save a copy of your checkmarks, delivery counts, personal tasks and notes.</p><a class="btn primary" href="/api/export?save=${currentSave.id}&profile=${currentProfile.id}" download>Download progress JSON ↓</a><p class="small muted">The Docker volume keeps progress through container updates. This download gives you a separate copy.</p></section><section class="panel"><h2>Restore a backup</h2><p>Import a backup from this planner. It replaces current progress after confirmation; factory-plan data stays unchanged.</p><label class="btn">Choose backup file<input id="import-file" type="file" accept="application/json,.json" hidden></label><p class="small muted">Up to 2 MB. The previous state is also retained as workspace.json.bak on the server. The original progress file is kept during migration.</p></section></div><section class="panel" style="margin-top:24px"><h2>Save-wide notes</h2><textarea id="global-note" class="notes" maxlength="6000" aria-label="Save-wide notes">${esc(state.notes.global||'')}</textarea><div class="note-save"><span class="small muted">Seed, locations, routes and decisions.</span><button class="btn" data-save-note="global" data-input="global-note">Save notes</button></div></section><section class="panel"><h2>Plan assumptions</h2><p class="small">All tiers through 6 unlocked. Phase 3 Versatile Frameworks delivered. Pure nodes, 50× elevator costs, half consumption. Retire coal and temporary fuel; retain turbofuel. Phase 5 resource conversion and extra Reanimated SAM are included. Ground-floor storage shell is already built; individual containers are not assumed connected.</p><p class="small">The final extra storage modules need additional input allocations. After Phase 5, storage takes priority over maintaining full elevator-export rates for sinking. Gathered items require collection; equipment and inhalers are manually crafted.</p><div class="list-links">${plan.sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)} ↗</a>`).join('')}</div></section>`;}
const itemIcon=name=>name?`<img class="item-icon" src="./icons/${slug(String(name).replace(/\s*\([^)]*\)\s*$/,''))}.png" width="42" height="42" loading="lazy" alt="">`:'';
// Belt/pipe logistics. Capacities are game constants; the unlocking milestone (tier, name) comes from progression.json.
const FLUIDS=new Set(['Fuel','Rocket Fuel','Nitric Acid','Turbofuel','Ionized Fuel','Dark Matter Residue','Excited Photonic Matter','Heavy Oil Residue','Alumina Solution','Sulfuric Acid','Dissolved Silica','Nitrogen Gas','Water','Crude Oil','Liquid Biofuel']);
const BELT_LANES=[{mark:'Mk.1',cap:60,entry:'Schematic_1-2_C'},{mark:'Mk.2',cap:120,entry:'Schematic_3-2_C'},{mark:'Mk.3',cap:270,entry:'Schematic_5-3_C'},{mark:'Mk.4',cap:480,entry:'Schematic_6-1_C'},{mark:'Mk.5',cap:780,entry:'Schematic_7-2_C'},{mark:'Mk.6',cap:1200,entry:'Schematic_9-5_C'}];
const PIPE_LANES=[{mark:'Mk.1',cap:300,entry:'Schematic_3-1_C'},{mark:'Mk.2',cap:600,entry:'Schematic_6-5_C'}];
// Oil-campus recipes per machine at 100%, per minute; values from the bundled recipes.json dataset.
const OIL_RECIPES={
 'Plastic':{in:{'Crude Oil':30},out:{'Plastic':20,'Heavy Oil Residue':10}},
 'Rubber':{in:{'Crude Oil':30},out:{'Rubber':20,'Heavy Oil Residue':20}},
 'Residual Fuel':{in:{'Heavy Oil Residue':60},out:{'Fuel':40}},
 'Residual Rubber':{in:{'Polymer Resin':40,'Water':40},out:{'Rubber':20}},
 'Alternate: Heavy Oil Residue':{in:{'Crude Oil':30},out:{'Heavy Oil Residue':40,'Polymer Resin':20}},
 'Alternate: Diluted Fuel':{in:{'Heavy Oil Residue':50,'Water':100},out:{'Fuel':100}},
 'Alternate: Recycled Plastic':{in:{'Rubber':30,'Fuel':30},out:{'Plastic':60}},
 'Alternate: Recycled Rubber':{in:{'Plastic':30,'Fuel':30},out:{'Rubber':60}}};
const phaseForLaneTier=t=>t<=2?1:t<=4?2:t<=6?3:t<=8?4:5;
function laneMilestone(l){const e=progressionData?.entries.find(x=>x.id===l.entry);return e?{name:e.name,tier:e.tier,phase:phaseForLaneTier(e.tier),marked:checked('unlock-'+e.id)}:null;}
function bestLane(fluid,st){
 const lanes=fluid?PIPE_LANES:BELT_LANES;const stageNo=Number(st??stage());let best=lanes[0],ms=laneMilestone(lanes[0]);
 for(const l of lanes){const m=laneMilestone(l);if(!m||m.marked||m.phase<=stageNo){best=l;ms=m;}}
 const next=lanes[lanes.indexOf(best)+1];
 return {...best,fluid,unit:fluid?' m³/min':'/min',milestone:ms,next:next?{...next,milestone:laneMilestone(next)}:null};
}
function lanePlan(rate,fluid,st){const lane=bestLane(fluid,st);const count=Math.max(1,Math.ceil(rate/lane.cap-1e-9));const last=rate-(count-1)*lane.cap;return {lane,count,last,full:count-(last<lane.cap-1e-9?1:0),spare:count*lane.cap-rate,word:fluid?'pipe':'belt'};}
const machinesLabel=(count,machine)=>count>1?`1 of the ${num(count)} ${esc(machine.replace(/y$/,'ie'))}s`:`1 × ${esc(machine)}`;
function recipeCell([n,q,link],out){
 const inner=`${n==='MW'?'':itemIcon(n)}<span class="rail-main"><b>${num3(q)}${FLUIDS.has(n)?' m³':n==='MW'?' MW':''}</b><small>${n==='MW'?'Power generation':esc(n)}</small></span>`;
 return link?`<button class="rail-cell${out?' out':''}" ${link}>${inner}</button>`:`<div class="rail-cell${out?' out':''}">${inner}</div>`;
}
function recipePanelHtml(m){
 const rc=m.recipe;if(!rc)return '';
 return `<div class="rail-recipe"><div class="rail-recipe-head"><span>Recipe · ${esc(rc.name)}</span><span>what ${machinesLabel(m.machineCount,rc.machine)} makes @ 100% · per minute</span></div><div class="rail-recipe-body"><div class="rail-recipe-ins">${rc.ins.map(x=>recipeCell(x)).join('')||'<div class="rail-cell"><span class="rail-main"><small>No belt or pipe inputs</small></span></div>'}</div><span class="rail-recipe-arrow">→</span><div class="rail-recipe-outs">${rc.outs.map(x=>recipeCell(x,true)).join('')}</div></div></div>`;
}
function flowHtml(m){
 if(!m||(!m.inputs.length&&!m.outputs.length))return '';
 const inTile=i=>{const p=i.plan,load=Math.round(i.rate/(p.count*p.lane.cap)*100);
  const inner=`${itemIcon(i.name)}<span class="rail-main"><b>${esc(i.name)}</b><small${load>=70?' class="hot"':''}>${p.count} × ${p.lane.mark} ${p.word}${p.count>1?'s':''} · ${load}% load</small></span><span class="rail-rate">${num(i.rate)}<small>${p.lane.unit}</small></span>`;
  return i.link?`<button class="rail-tile" ${i.link}>${inner}</button>`:`<div class="rail-tile">${inner}</div>`;};
 const outRow=o=>{
  const subs={consumer:`consumer${o.beltTxt?' · '+o.beltTxt:''}`,store:'protected module',ship:o.shipSub||'delivery',drone:'protected supply contract',sink:o.subTxt||'whole-machine rounding surplus',more:'combined smaller destinations'};
  const name=o.link?`<button class="rail-link" ${o.link}>${esc(o.label)} ↗</button>`:`<b class="${o.kind==='sink'||o.kind==='more'?'dim':''}">${esc(o.label)}</b>`;
  const machCol=o.mach===undefined?'<span class="rail-mach"></span>':`<span class="rail-mach"><b>≈ ${o.mach<0.5?'<1':num(Math.ceil(o.mach-1e-9))}</b> × ${esc(m.machineName)}<small>${num(o.mach)} at 100% · ${m.local?'build beside it':'round up'}</small></span>`;
  const rate=o.rateTxt??(o.rate!==undefined?`${num(o.rate)}<small>${o.unit||'/min'}</small>`:'');
  return `<div class="rail-row ${o.kind}">${o.icon?itemIcon(o.icon):'<span class="rail-noicon"></span>'}<span class="rail-main">${name}<small>${o.pre?esc(o.pre)+' · ':''}${subs[o.kind]||''}</small></span>${machCol}<span class="rail-rate">${rate}</span></div>`;};
 const bar=m.bar?`${m.inputs.length?'<div class="rail-arrow">↓</div>':''}<div class="rail-machine"><div class="rail-machine-main"><b>${num(m.machineCount)} × ${esc(m.machineName)}</b><small>${m.bar.sub}</small></div><div class="rail-machine-out"><b>${m.bar.outTxt}</b><small>${m.bar.outSub}</small></div></div>${m.outputs.length?'<div class="rail-arrow">↓</div>':''}`:'';
 return `<h3>Flow at ${phaseLabel(m.stage)}</h3>${recipePanelHtml(m)}${m.inputs.length?`<div class="rail-cap">Inputs · ${m.inputs.length} line${m.inputs.length>1?'s':''} in</div><div class="rail-grid">${m.inputs.map(inTile).join('')}</div>`:''}${bar}${m.outputs.length?`<div class="rail-caps"><span class="rail-cap">Delivers · ${phaseLabel(m.stage)}</span>${m.outputs.some(o=>o.mach!==undefined)?`<span class="rail-cap">Machines per delivery · ${num(m.machineCount)} total</span>`:''}</div><div class="rail-rows">${m.outputs.map(outRow).join('')}</div>${m.bankNote||''}`:''}`;
}
function capFlowOutputs(list,unit='/min'){if(list.length<=10)return list;const rest=list.slice(9),sum=rest.reduce((s,x)=>s+(x.rate||0),0);return [...list.slice(0,9),{kind:'more',label:`+ ${rest.length} more destinations`,rate:sum,unit}];}
function laneAdviceHtml(m){
 if(!m||!m.inputs.length)return '';
 const belts=bestLane(false,m.stage),pipes=bestLane(true,m.stage);
 const nextNote=belts.next?.milestone?` ${belts.next.mark} belts (${num(belts.next.cap)}/min) unlock at Tier ${belts.next.milestone.tier} · ${esc(belts.next.milestone.name)} in Phase ${belts.next.milestone.phase}.`:'';
 const rows=m.inputs.map(i=>{
  const p=i.plan,l=p.lane,per=i.rate/m.equivalent,fed=Math.floor(l.cap/per+1e-9);
  const parts=[`<b>${num(i.rate)}${l.unit}</b> → <b>${p.count} × ${l.mark} ${p.word}${p.count>1?'s':''}</b>${p.count>1?` — ${p.full} full + 1 carrying ${num(p.last)}${l.unit}`:` (${Math.round(i.rate/l.cap*100)}% of ${num(l.cap)}${l.unit})`}.`];
  if(m.machineCount>1)parts.push(fed<1?`Each machine takes ${num(per)}${l.unit} — more than one ${l.mark} ${p.word} carries, so give machines dedicated feeds.`:m.machineCount>fed?`One full ${l.mark} ${p.word} feeds <b>${fed} of the ${num(m.machineCount)} machines</b> (${num(per)}${l.unit} each) — plan manifold rows of ${fed}.`:`One ${l.mark} ${p.word} feeds all ${num(m.machineCount)} machines (${num(per)}${l.unit} each).`);
  if(p.count>1&&p.spare>0.01){
   const merge=m.sameItemConsumers(i.name).filter(x=>x.rate<=p.spare+0.01);
   parts.push(`The last ${p.word} has <b>${num(p.spare)}${l.unit} spare</b> — ${merge.length?`enough to also carry ${merge.slice(0,2).map(x=>`<button class="btn quiet" ${x.attr}>${esc(x.label)} (${num(x.rate)}${l.unit}) ↗</button>`).join(' or ')} from the same bus`:'keep it as expansion headroom on this manifold'}.`);
  }
  if(i.local)parts.push(i.local);
  return `<div class="logi-row">${itemIcon(i.name)}<div><b>${esc(i.name)}</b>${parts.map(t=>`<p>${t}</p>`).join('')}</div></div>`;
 }).join('');
 return `<h3>Belts &amp; pipes</h3><p class="small muted">${phaseLabel(m.stage)} milestones give ${belts.mark} belts (${num(belts.cap)}/min) and ${pipes.mark} pipes (${num(pipes.cap)} m³/min).${nextNote} If a milestone is not unlocked in your save yet, plan with the earlier mark.</p><div class="logi">${rows}</div>`;
}
function handbookFlowModel(f,st,r,localInput,bankOnly=false){
 const fluidOut=FLUIDS.has(f.name);const unit=fluidOut?' m³/min':'/min';
 const eq=Math.max(r.machines-1+(r.lastClock??100)/100,0.01);const perOut=r.output/eq;
 const beltTxt=p=>`${p.count} × ${p.lane.mark} ${p.word}${p.count>1?'s':''}`;
 const mach=q=>bankOnly?undefined:q/perOut;
 const consumers=plan.factories.filter(o=>o.id!==f.id&&o.stages[st]?.inputs?.[f.name]).map(o=>{const q=o.stages[st].inputs[f.name];return {kind:'consumer',label:o.name,icon:o.name,link:`data-factory="${o.id}"`,rate:q,unit,mach:mach(q),beltTxt:f.local?'made on site':beltTxt(lanePlan(q,fluidOut,st))};}).sort((a,b)=>b.rate-a.rate);
 const outputs=[...consumers];
 if(f.nuclear&&!consumers.length)outputs.push({kind:'ship',label:'Nuclear power fleet',shipSub:'planned in Power & resources',icon:f.name,rateTxt:''});
 if(r.storage)outputs.push({kind:'store',label:'Storage refill',icon:f.name,rate:r.storage,unit,mach:mach(r.storage)});
 if(r.delivery)outputs.push({kind:'ship',label:'Space Elevator delivery',icon:f.name,rate:r.delivery,unit,mach:mach(r.delivery)});
 const surplus=Math.max(0,r.output-(r.demand??r.output));
 if(surplus>0.002)outputs.push({kind:'sink',label:'AWESOME Sink',icon:f.name,rate:surplus,unit});
 const inputs=bankOnly?[]:Object.entries(r.inputs||{}).map(([n,q])=>{const lp=localInput(n);const src=lp||plan.factories.find(x=>x.name===n&&x.stages[st]);return {name:n,rate:q,link:src?`data-factory="${src.id}"`:'',plan:lanePlan(q,FLUIDS.has(n),st),local:lp?`<button class="btn quiet" data-factory="${lp.id}">Local: ≈ ${num(Math.ceil(q/lp.stages[st].rate))} × ${esc(lp.stages[st].machine)} at this site ↗</button>`:''};});
 const capped=capFlowOutputs(outputs,unit);
 const splits=capped.filter(o=>o.mach!==undefined&&o.kind!=='sink');
 const splitTxt=splits.length>1?` · split ≈ ${splits.map(o=>num(Math.ceil(o.mach-1e-9))).join(' / ')} across the deliveries below`:'';
 const clock=(r.lastClock??100)<100?`@ 100% except the last at ${num(r.lastClock)}%`:'@ 100%';
 return {stage:st,inputs,outputs:capped,equivalent:eq,machineCount:r.machines,machineName:r.machine,local:!!f.local,
  recipe:bankOnly?null:{name:String(r.recipe||'').replace('Alternate: ',''),machine:r.machine,ins:inputs.map(i=>[i.name,i.rate/eq,i.link]),outs:[[f.name,perOut]]},
  bar:bankOnly?null:{sub:`${esc(String(r.recipe||'').replace('Alternate: ',''))} · ${clock} · ${num3(perOut)} ${esc(f.name)}/min out per machine${splitTxt}${f.local?' · built beside the consumers':''}`,outTxt:`${num(r.output)}<small>${unit}</small>`,outSub:f.local?'out · distributed':'out · '+beltTxt(lanePlan(r.output,fluidOut,st))},
  sameItemConsumers:n=>plan.factories.filter(o=>o.id!==f.id&&o.stages[st]?.inputs?.[n]).map(o=>({label:o.name,rate:o.stages[st].inputs[n],attr:`data-factory="${o.id}"`}))};
}
function calcFlowModel(r){
 const x=calcStage(),st=stage(),multi=Object.keys(r.outputs||{}).length>1;
 const eq=Math.max(r.equivalent||r.machines-1+(r.lastClock??100)/100||1,0.01);
 const beltTxt=p=>`${p.count} × ${p.lane.mark} ${p.word}${p.count>1?'s':''}`;
 const outputs=[];
 for(const n of Object.keys(r.outputs||{})){
  const fluid=FLUIDS.has(n),unit=fluid?' m³/min':'/min',pre=multi?n:'',perOut=r.outputs[n]/eq;
  const mach=q=>multi?undefined:q/perOut;
  for(const o of (x.rows||[]).filter(o=>o.id!==r.id&&o.inputs?.[n]))outputs.push({kind:'consumer',label:o.name,icon:Object.keys(o.outputs||{})[0]||n,link:`data-calc-factory="${o.id}"`,rate:o.inputs[n],unit,pre,mach:mach(o.inputs[n]),beltTxt:beltTxt(lanePlan(o.inputs[n],fluid,st))});
  if(x.storage?.[n])outputs.push({kind:'store',label:'Protected storage',icon:n,rate:x.storage[n],unit,pre,mach:mach(x.storage[n])});
  if(x.delivery?.[n]?.rate)outputs.push({kind:'ship',label:'Space Elevator delivery',icon:n,rate:x.delivery[n].rate,unit,pre,mach:mach(x.delivery[n].rate)});
  if(x.drone?.[n])outputs.push({kind:'drone',label:'Drone fuel contract',icon:n,rate:x.drone[n],unit,pre,mach:mach(x.drone[n])});
  if(st==='5'&&n==='Singularity Cell'&&calculated.settings.cellsPerMinute)outputs.push({kind:'ship',label:'Extra Singularity Cells',shipSub:'configured portal supply',icon:n,rate:calculated.settings.cellsPerMinute,unit,pre,mach:mach(calculated.settings.cellsPerMinute)});
  if(n==='Plutonium Fuel Rod'&&x.plutoniumSink)outputs.push({kind:'sink',label:'AWESOME Sink',subTxt:'waste strategy — sink these rods',icon:n,rate:x.plutoniumSink,unit,pre});
  if(x.surplus?.[n]>0.002)outputs.push({kind:'sink',label:'AWESOME Sink',icon:n,rate:x.surplus[n],unit,pre});
 }
 outputs.sort((a,b)=>(b.rate||0)-(a.rate||0));
 if(!outputs.length&&r.generationMW)outputs.push({kind:'ship',label:'Power grid',shipSub:'generation',rateTxt:power(r.generationMW)});
 const inputs=Object.entries(r.inputs||{}).map(([n,q])=>{const src=(x.rows||[]).find(o=>o.id!==r.id&&o.outputs?.[n]);return {name:n,rate:q,link:src?`data-calc-factory="${src.id}"`:'',plan:lanePlan(q,FLUIDS.has(n),st)};});
 const outName=Object.keys(r.outputs||{})[0];
 const capped=capFlowOutputs(outputs);
 const splits=capped.filter(o=>o.mach!==undefined&&o.kind!=='sink');
 const splitTxt=splits.length>1?` · split ≈ ${splits.map(o=>num(Math.ceil(o.mach-1e-9))).join(' / ')} across the deliveries below`:'';
 const clock=r.machines-eq>1e-7?'@ 100% + 1 adjustable':'@ 100%';
 const shared=Object.keys(r.outputs||{}).some(n=>(x.rows||[]).some(o=>o.id!==r.id&&o.outputs?.[n]));
 return {stage:st,inputs,outputs:capped,equivalent:eq,machineCount:r.machines,machineName:r.machine,local:false,
  recipe:{name:r.name,machine:r.machine,ins:inputs.map(i=>[i.name,i.rate/eq,i.link]),outs:outName?Object.entries(r.outputs).map(([n,q])=>[n,q/eq]):[['MW',r.generationMW/eq]]},
  bar:{sub:`${esc(r.name)} · ${clock}${outName&&!multi?` · ${num3(r.outputs[outName]/eq)} ${esc(outName)}/min out per machine`:''}${splitTxt}`,outTxt:outName?`${num(r.outputs[outName])}<small>${FLUIDS.has(outName)?' m³/min':'/min'}</small>`:power(r.generationMW),outSub:outName?(multi?'out · '+esc(outName)+' + byproducts':'out · '+beltTxt(lanePlan(r.outputs[outName],FLUIDS.has(outName),st))):'generation'},
  bankNote:outputs.length?`<p class="small muted">Demand for the item across this phase's whole plan${shared?', supplied together with the other recipes producing it':''}.</p>`:'',
  sameItemConsumers:n=>(x.rows||[]).filter(o=>o.id!==r.id&&o.inputs?.[n]).map(o=>({label:o.name,rate:o.inputs[n],attr:`data-calc-factory="${o.id}"`}))};
}
function dialog(title,subtitle,body,icon=''){const d=$('#detail');d.innerHTML=`<header class="dialog-head"><div class="dialog-title">${icon?`<span class="dialog-icon">${itemIcon(icon)}</span>`:''}<div><div class="eyebrow">${subtitle}</div><h2>${esc(title)}</h2></div></div><button class="close" aria-label="Close details" data-close>×</button></header><div class="dialog-body">${body}</div>`;if(!d.open)d.showModal();}
function openFactory(id){
 const f=plan.factories.find(x=>x.id===id);if(!f)return;activeDetail={type:'factory',id};const r=f.stages[stage()]||Object.values(f.stages)[0];
 const oil=['Plastic','Rubber'].includes(f.name);
 let installed={};const history=Object.entries(f.stages).map(([ph,x])=>{
  const campus=oil?(plan.plans[ph]?.oil||[]).reduce((a,c)=>a+c.machines,0):0;
  const machines=oil?campus:x.machines,label=oil?'shared campus buildings':esc(x.machine);
  const old=installed[label]||0;const added=Math.max(0,machines-old);installed[label]=Math.max(old,machines);
  return `<tr><td>${ph}</td><td>${num(x.output)}</td><td>${num(x.storage)}</td><td>${num(machines)} ${label}</td><td>${added?`+${num(added)}`:'Keep capacity'}</td></tr>`;}).join('');
 const st=f.stages[stage()]?stage():Object.keys(f.stages)[0];
 const localInput=n=>plan.factories.find(x=>x.local&&x.name===n&&x.stages[st]);
 const flow=handbookFlowModel(f,st,r,localInput,oil);
 dialog(f.name,`${phaseLabel(st)} · Handbook page ${f.page}`,`
 <span class="badge orange">${esc(r.recipe)}</span><div class="stats">${stat('Output',num(r.output)+'/min','Total production')}${stat('Storage',num(r.storage)+'/min','Protected allowance')}${stat('Machines',oil?'Campus':num(r.machines),oil?'Shared oil processes':esc(r.machine))}</div>
 ${f.note?`<div class="notice blue">${esc(f.note)}</div>`:''}${f.local?'<div class="notice">Distributed production budget: build these machines beside the consumers listed below, plus the storage refill module. Independent site rounding can require additional machines.</div>':''}${flowHtml(flow)}${usageNotesHtml(f,st)}${f.nuclear?'<div class="notice">Process buffer at the nuclear site. Keep radioactive recycling flows balanced; do not apply a generic storage surplus.</div>':''}
 ${oil?oilDetail(st):laneAdviceHtml(flow)+`<p class="small muted">${num(r.machines)} whole buildings. All at 100%, except the last at ${num(r.lastClock)}%. Peak production load ${num(r.peakMW)} MW; upstream factories and logistics are separate.${Object.keys(r.inputs).some(localInput)?' Local inputs are produced beside this factory; their machines are part of the shared distributed budget.':''}</p>`}
 <h3>Expansion across phases</h3><div class="table-wrap"><table><thead><tr><th>Phase</th><th>Output/min</th><th>Storage/min</th><th>Required</th><th>Add</th></tr></thead><tbody>${history}</tbody></table></div><p class="small muted">Keep larger earlier installed capacity. Recipe changes need their new input routes. Counts are running requirements, not a demolition instruction.${oil?' Campus buildings are shared with the other polymer export and produce both together; the shared oil campus stages above list machines per recipe. Phase 4 replaces the simple Phase 3 refineries with the recycled loops.':''}</p>
 <div class="detail-actions"><label class="check-row"><input type="checkbox" data-check="factory-${st}-${f.id}" ${doneAttr('factory-'+st+'-'+f.id)}>Running at Phase ${st} target</label></div>
 <h3>Factory notes</h3><textarea id="detail-note" class="notes" maxlength="6000" aria-label="Factory notes">${esc(state.notes['factory-'+f.id]||'')}</textarea><div class="note-save"><span class="small muted">Location, transport, next expansion.</span><button class="btn" data-save-note="factory-${f.id}" data-input="detail-note">Save notes</button></div>`,f.name);
}
function usageNotesHtml(f,st){
 const r=f.stages[st];
 const consumers=plan.factories.some(o=>o.id!==f.id&&o.stages[st]?.inputs?.[f.name]);
 const completion=phase()==='post'?plan.completion.filter(c=>c.inputs?.[f.name]):[];
 return (consumers||r.delivery?'':f.nuclear?`<p class="small muted">${esc(f.name)} is consumed by the nuclear power fleet, which is planned in <a href="#resources">Power &amp; resources</a> rather than as a factory target. Keep its flow inside the nuclear site.</p>`:r.storage?`<p class="small muted">No factory in this plan consumes ${esc(f.name)} directly; this capacity only refills the protected storage. The refill rate is a protected maximum, not continuous consumption — the machines idle once the container is full and only run while you take ${esc(f.name)} out.</p>`:'')+
 (completion.length?`<p class="small muted">Additional completion modules also use ${esc(f.name)}: ${completion.map(c=>esc(c.name)+' '+num(c.inputs[f.name])+'/min').join(' · ')}. Allocate their supply on top of this factory's budget.</p>`:'');
}
function oilDetail(st){
 const p=plan.plans[st];
 const stages=p.oil.map(x=>({...x,rc:OIL_RECIPES[x.recipe]||{in:{},out:{}}}));
 const pipeTxt=q=>{const pl=lanePlan(q,true,st);return `${pl.count} × ${pl.lane.mark} pipe${pl.count>1?'s':''}`;};
 const fuelConsumer=plan.factories.find(ff=>!['plastic','rubber'].includes(ff.id)&&ff.stages[st]?.inputs?.Fuel);
 const bank=`<div class="rail-cap">Campus inputs</div><div class="rail-grid">${[['Crude Oil',p.oilTotals.crude],['Water',p.oilTotals.water]].filter(([,q])=>q>0.01).map(([n,q])=>`<div class="rail-tile">${itemIcon(n)}<span class="rail-main"><b>${esc(n)}</b><small>${pipeTxt(q)}</small></span><span class="rail-rate">${num(q)}<small> m³/min</small></span></div>`).join('')}</div>`;
 const stageHtml=stages.map(x=>{
  const tot=side=>Object.entries(x.rc[side]).map(([n,q])=>`${num(q*x.equivalent)}${FLUIDS.has(n)?' m³':''} ${esc(n)}`).join(' + ');
  const dest=Object.keys(x.rc.out).map(n=>{
   const parts=stages.filter(o=>o!==x&&o.rc.in[n]).map(o=>`the ${esc(o.recipe.replace('Alternate: ',''))} ${esc(o.machine.replace(/y$/,'ie'))}s`);
   if(n==='Plastic'||n==='Rubber')parts.push('campus export');
   if(n==='Fuel'){if(Number(p.oilTotals.generators)>0)parts.push(`${num(p.oilTotals.generators)} Fuel Generators (${num(p.oilTotals.grossGW)} GW gross)`);else if(p.oilTotals.fuel>0.01)parts.push(`export ${num(p.oilTotals.fuel)}/min${fuelConsumer?` to <button class="btn quiet" data-factory="${fuelConsumer.id}">${esc(fuelConsumer.name)} ↗</button>`:''}`);}
   return parts.length?`${esc(n)} → ${parts.join(' + ')}`:'';
  }).filter(Boolean).join('<br>');
  const whole=Math.floor(x.equivalent+1e-7),frac=x.equivalent-whole;
  const clock=frac>1e-7?`${num(whole)} at 100% + 1 at ≈ ${num(frac*100)}%`:`all at 100%`;
  return `<div class="rail-arrow">↓</div><div class="rail-machine"><div class="rail-machine-main"><b>${num(x.machines)} × ${esc(x.machine)}</b><small>${esc(x.recipe)} · ${clock} · in ${tot('in')||'—'} · out ${tot('out')}</small></div></div><div class="rail-recipe"><div class="rail-recipe-head"><span>Recipe · ${esc(x.recipe.replace('Alternate: ',''))}</span><span>what ${machinesLabel(x.machines,x.machine)} makes @ 100% · per minute</span></div><div class="rail-recipe-body"><div class="rail-recipe-ins">${Object.entries(x.rc.in).map(c=>recipeCell(c)).join('')}</div><span class="rail-recipe-arrow">→</span><div class="rail-recipe-outs">${Object.entries(x.rc.out).map(c=>recipeCell(c,true)).join('')}</div></div></div>${dest?`<p class="small muted">${dest}</p>`:''}`;
 }).join('');
 return `<h3>Shared oil campus · ${phaseLabel(st)}</h3><p>One campus makes Plastic and Rubber together. Crude never feeds the polymer machines directly${st==='3'?': the standard refineries turn it into the polymers plus Heavy Oil Residue, which becomes generator fuel.':': it becomes Heavy Oil Residue and Polymer Resin first, and the polymers come out of the fuel-driven recycled loops.'} Build the stages in this order; recipe cells are per machine at 100%, per minute.</p><p class="small muted">Flow rates here stay exactly balanced instead of rounded up: unpackaged fluids cannot overflow to the AWESOME Sink, and the loops feed themselves, so surplus fluid would back the chain up. Machine counts are whole — only each stage's last machine runs underclocked.</p>${bank}${stageHtml}<p>${st==='3'?`Burn all ${num(p.oilTotals.fuel)} Fuel/min in ${p.oilTotals.generators} generators (last underclocked), giving ${num(p.oilTotals.grossGW)} GW gross. This additional Phase 3 byproduct power is not counted in later capacity totals.`:`Export ${num(p.oilTotals.fuel)} Fuel/min; remaining fuel and recycled polymers are internal flows. <b>Seeding the loops:</b> run the Residual Rubber Refineries from resin first, feed that rubber with fuel into Recycled Plastic, then bring Recycled Rubber online — open the campus exports only once both loops are saturated.`}</p>`;
}
function groupChainNodes(gid){
 if(calculated){
  const x=calcStage();
  return (x.rows||[]).filter(r=>membershipsOf(r.id).some(m=>m.group===gid)).map(r=>({id:r.id,attr:`data-calc-factory="${r.id}"`,name:r.name,machine:r.machine,machines:r.machines,inputs:r.inputs||{},outputs:r.outputs||{},mw:r.generationMW}));
 }
 const st=stage();
 return plan.factories.filter(f=>f.stages[st]&&membershipsOf(f.id).some(m=>m.group===gid)).map(f=>{const r=f.stages[st];return {id:f.id,attr:`data-factory="${f.id}"`,name:f.name,machine:r.machine,machines:r.machines,inputs:r.inputs||{},outputs:{[f.name]:r.output},recipe:r.recipe};});
}
function openGroupChain(gid){
 const gr=factoryGroupsState().groups.find(g=>g.id===gid);if(!gr)return;activeDetail={type:'group',id:gid};
 const nodes=groupChainNodes(gid);
 if(!nodes.length)return dialog(gr.name,'Factory group · build order','<p class="small muted">No factories from this group produce anything in the current phase.</p>');
 const makers=n=>nodes.filter(o=>o.outputs[n]);
 const placed=[],placedSet=new Set(),loopSeeds=new Map(),pending=[...nodes];
 while(pending.length){
  let idx=pending.findIndex(nd=>Object.keys(nd.inputs).every(n=>makers(n).every(m=>placedSet.has(m.id)||m===nd)));
  let loop=false;
  if(idx<0){
   let bestCount=Infinity;idx=0;
   pending.forEach((nd,i)=>{const c=Object.keys(nd.inputs).filter(n=>makers(n).some(m=>!placedSet.has(m.id)&&m!==nd)).length;if(c<bestCount){bestCount=c;idx=i;}});
   loop=true;
  }
  const nd=pending.splice(idx,1)[0];
  if(loop)loopSeeds.set(nd.id,Object.keys(nd.inputs).filter(n=>makers(n).some(m=>!placedSet.has(m.id)&&m!==nd)));
  placed.push(nd);placedSet.add(nd.id);
 }
 const stageNo=new Map(placed.map((nd,i)=>[nd.id,i+1]));
 const others=calculated?(calcStage().rows||[]):plan.factories.filter(f=>f.stages[stage()]).map(f=>({id:f.id,name:f.name,inputs:f.stages[stage()].inputs||{}}));
 const html=placed.map((nd,i)=>{
  const loopIns=loopSeeds.get(nd.id)||[];
  const needs=Object.entries(nd.inputs).map(([n,q])=>{
   const from=makers(n).filter(m=>m!==nd);
   const src=loopIns.includes(n)?'<b class="chain-loop">loop — seed a starter batch</b>':from.length?'stage '+Math.min(...from.map(m=>stageNo.get(m.id))):'outside the group';
   return `${esc(n)} ${num(q)}${FLUIDS.has(n)?' m³':''}/min <span class="muted">· ${src}</span>`;
  }).join('<br>');
  const feeds=Object.keys(nd.outputs).map(n=>{
   const inGroup=nodes.filter(o=>o!==nd&&o.inputs[n]).map(o=>`stage ${stageNo.get(o.id)} · ${esc(o.name)}`);
   const outside=others.filter(o=>o.id!==nd.id&&o.inputs?.[n]&&!nodes.some(g=>g.id===o.id)).length;
   const parts=[...inGroup];if(outside)parts.push(`${outside} ${outside===1?'factory':'factories'} outside the group`);
   return `${esc(n)} → ${parts.join(' · ')||'storage, export or sink'}`;
  }).join('<br>')||(nd.mw?'Power grid':'—');
  return `<div class="chain-stage"><span class="chain-no">${String(i+1).padStart(2,'0')}</span><div class="chain-body"><div class="chain-title"><button class="rail-link" ${nd.attr}>${esc(nd.name)} ↗</button><span class="muted">${num(nd.machines)} × ${esc(nd.machine)}</span></div>${needs?`<p class="small"><b>Needs</b><br>${needs}</p>`:'<p class="small muted">No belt or pipe inputs.</p>'}<p class="small"><b>Feeds</b><br>${feeds}</p></div></div>`;
 }).join('');
 const split=nodes.some(nd=>membershipsOf(nd.id).some(m=>m.group===gid&&m.rate!=null));
 dialog(gr.name,`Factory group · build order · ${phaseLabel(stage())}`,`<p class="small muted">Stages are ordered so suppliers come before their consumers. An input marked <b>loop</b> is produced by a later stage: run that stage from a starter batch first, then close the loop.</p><div class="chain">${html}</div>${split?'<p class="small muted">Rates are the whole plan’s totals; this group’s production split is shown on the factory cards.</p>':''}`);
}
function openSlot(id){const b=storageBays().find(b=>b.items.some(x=>x.id===id));const x=b?.items.find(x=>x.id===id);if(!x?.name)return;activeDetail={type:'slot',id};const factory=calculated?calcStage().rows?.find(r=>r.outputs[x.name]):plan.factories.find(f=>f.name===x.name);const index=Number(id.slice(b.id.length));dialog(x.name,`${id} · ${esc(storageFloors().find(f=>f.id===b.floor)?.label||b.floor)} · Bay ${b.id}`,`<p><b>${esc(b.name)}</b><br>${index<=4?'Rear':'Front'} bank, position ${(index-1)%4+1} from the left on the floor plan.</p><div class="check-columns">${[['built','Container placed'],['labelled','Sign and address labelled'],['connected','Correct supply connected'],['verified','Flow and overflow verified']].map(([k,l])=>`<label class="check-row"><input type="checkbox" data-check="slot-${id}-${k}" ${doneAttr('slot-'+id+'-'+k)}>${l}</label>`).join('')}</div>${factory?`<div class="detail-actions"><button class="btn" ${calculated?'data-calc-factory':'data-factory'}="${factory.id}">Open production target →</button></div>`:'<p class="small muted">Collected or completion item. Reserve its own supply; this storage position does not add production capacity.</p>'}<h3>Container notes</h3><textarea id="detail-note" class="notes" maxlength="6000" aria-label="Container notes">${esc(state.notes['slot-'+id]||'')}</textarea><div class="note-save"><span class="small muted">Belt source, splitter setting or remaining work.</span><button class="btn" data-save-note="slot-${id}" data-input="detail-note">Save notes</button></div>`,x.name);}
document.addEventListener('click',async e=>{
 const target=e.target.closest('button,a');if(!target)return;
 if(target.hasAttribute('data-close')){$('#detail').close();activeDetail=null;}
 if(target.dataset.factory)openFactory(target.dataset.factory);
 if(target.dataset.slot)openSlot(target.dataset.slot);
 if(target.dataset.completeBay){const bay=storageBays().find(b=>b.id===target.dataset.completeBay);if(bay){target.disabled=true;try{await save({type:'checks',keys:bay.items.filter(x=>x.name).flatMap(x=>slotKeys(x.id)),value:true});render();toast('Room '+bay.id+' completed. You can uncheck individual containers if needed.');}catch{}finally{target.disabled=false;}}}
 if(target.dataset.floor){floor=target.dataset.floor;query='';render();}
 if(target.hasAttribute('data-toggle-layout')){layoutEditing=!layoutEditing;render();}
 if(target.hasAttribute('data-toggle-plan-edit')){planEditing=!planEditing;editingTask=null;render();}
 if(target.hasAttribute('data-toggle-factory-edit')){factoryEditing=!factoryEditing;render();}
 if(target.dataset.moveTask){
  const ids=planTasks().map(t=>t.id),i=ids.indexOf(target.dataset.moveTask),j=i+Number(target.dataset.dir);
  if(i>=0&&j>=0&&j<ids.length){[ids[i],ids[j]]=[ids[j],ids[i]];try{await save({type:'taskOrder',phase:phase(),ids});render();}catch{}}
 }
 if(target.dataset.editTask){editingTask=target.dataset.editTask;render();}
 if(target.hasAttribute('data-cancel-task-edit')){editingTask=null;render();}
 if(target.dataset.removeStep){
  const id=target.dataset.removeStep;
  if(id.startsWith('custom-')){if(confirm('Delete this personal task?')){try{await save({type:'removeTask',id});render();}catch{}}}
  else if(confirm('Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.')){try{await save({type:'taskRemove',id});render();}catch{}}
 }
 if(target.dataset.restoreTask){try{await save({type:'taskRestore',id:target.dataset.restoreTask});render();}catch{}}
 if(target.dataset.removeGroup&&confirm('Remove this group? The factories stay in the list and keep their progress.')){try{await save({type:'factoryGroupRemove',id:target.dataset.removeGroup});render();}catch{}}
 if(target.dataset.unassign){
  const key=target.dataset.unassign,groups=membershipsOf(key).filter(m=>m.group!==target.dataset.group).map(m=>({group:m.group,rate:m.rate}));
  try{await save({type:'factoryAssign',key,groups});render();}catch{}
 }
 if(target.dataset.clearSlot){target.disabled=true;try{await save({type:'storageSlotClear',key:target.dataset.clearSlot});render();toast('Container cleared. Its saved checkmarks are kept with the address.');}catch{target.disabled=false;}}
 if(target.dataset.removeBay&&confirm('Remove this added bay? Saved checkmarks for its addresses are kept.')){target.disabled=true;try{await save({type:'storageBayRemove',id:target.dataset.removeBay});render();}catch{target.disabled=false;}}
 if(target.dataset.removeFloor&&confirm('Remove this added floor?')){target.disabled=true;try{await save({type:'storageFloorRemove',id:target.dataset.removeFloor});floor='ground';render();}catch{target.disabled=false;}}
 if(target.dataset.saveNote){const noteDialog=target.closest('dialog');target.disabled=true;try{await save({type:'note',key:target.dataset.saveNote,value:document.getElementById(target.dataset.input).value});if(noteDialog?.open&&noteDialog.contains(target)){noteDialog.close();activeDetail=null;}toast('Notes saved.');}catch{}finally{target.disabled=false;}}
 if(target.dataset.remove&&confirm('Delete this personal task?')){try{await save({type:'removeTask',id:target.dataset.remove});render();}catch{}}
});
document.addEventListener('change',async e=>{
 const el=e.target;
 if(el.dataset.completeSlot){const value=el.checked;el.disabled=true;try{await save({type:'checks',keys:slotKeys(el.dataset.completeSlot),value});render();}catch{el.checked=!value;}finally{el.disabled=false;}}
 if(el.dataset.check){const value=el.checked;el.disabled=true;try{await save({type:'check',key:el.dataset.check,value});render();}catch{el.checked=!value;}finally{el.disabled=false;}}
 if(el.id==='phase-picker'){el.disabled=true;try{await save({type:'phase',value:el.value});query='';render();}catch{el.value=phase();}finally{el.disabled=false;}}
 if(el.id==='factory-filter'){factoryFilter=el.value;render();}
 if(['recipes','mainPower','pureIngots'].includes(el.name)&&wizard&&$('#wizard-form')){readWizard($('#wizard-form'));render();}
 if(el.name==='alt'){const p=el.closest('.alt-picker');const head=p?.querySelector('.alt-picker-head b');if(head)head.textContent=`Alternate recipes · ${p.querySelectorAll('input[name=alt]:checked').length} selected`;const star=el.closest('.alt-row')?.querySelector('input[name=altpref]');if(star){star.disabled=!el.checked;if(!el.checked)star.checked=false;}}
 if(el.dataset.bayRename){el.disabled=true;try{await save({type:'storageBayRename',id:el.dataset.bayRename,name:el.value});}catch{}finally{el.disabled=false;render();}}
 if(el.dataset.groupRename){el.disabled=true;try{await save({type:'factoryGroupRename',id:el.dataset.groupRename,name:el.value});}catch{}finally{el.disabled=false;render();}}
 if(el.dataset.assignAdd&&el.value){
  const key=el.dataset.assignAdd,groups=[...membershipsOf(key).map(m=>({group:m.group,rate:m.rate})),{group:el.value,rate:null}];
  el.disabled=true;try{await save({type:'factoryAssign',key,groups});}catch{}finally{el.disabled=false;render();}
 }
 if(el.dataset.assignRate){
  const key=el.dataset.assignRate,raw=el.value.trim();let rate=null;
  if(raw!==''){rate=Number(raw);if(!Number.isFinite(rate)||rate<=0){toast('Enter a rate above 0, or leave the field empty for the whole output or the remainder.',true);render();return;}}
  const groups=membershipsOf(key).map(m=>m.group===el.dataset.group?{group:m.group,rate}:{group:m.group,rate:m.rate});
  el.disabled=true;try{await save({type:'factoryAssign',key,groups});}catch{}finally{el.disabled=false;render();}
 }
 if(el.dataset.delivery){const d=calculated?calculatedDelivery(el.dataset.delivery):plan.deliveries.find(x=>x.id===el.dataset.delivery),v=Number(el.value);if(!Number.isInteger(v)||v<0||v>d.target){toast('Enter a whole number between 0 and '+num(d.target)+'.',true);el.value=state.deliveries[d.id]??(currentProfile.id==='original'?d.initial:0);return;}try{await save({type:'delivery',key:d.id,value:v});render();}catch{el.value=state.deliveries[d.id]??(currentProfile.id==='original'?d.initial:0);}}
 if(el.id==='import-file'&&el.files[0]){const file=el.files[0];try{if(file.size>2*1024*1024)throw new Error('Choose a backup smaller than 2 MB.');const data=JSON.parse(await file.text());if(!confirm('Replace current progress with this backup?')){el.value='';return;}await writeQueue;state=await request('/api/import',{method:'POST',headers:{'Content-Type':'application/json','X-Planner-Request':'1',...scopeHeaders()},body:JSON.stringify(data)});render();toast('Backup restored.');}catch(err){toast(err.message||'Could not restore backup.',true);el.value='';}}
});
document.addEventListener('input',e=>{if(['factory-search','storage-search'].includes(e.target.id)){query=e.target.value;render();}
 if(e.target.id==='alt-filter'){const q=e.target.value.trim().toLowerCase();for(const row of document.querySelectorAll('.alt-row'))row.hidden=q!==''&&!row.dataset.altText.includes(q);}});
document.addEventListener('submit',async e=>{if(e.target.id==='add-task'){e.preventDefault();const title=new FormData(e.target).get('title').trim();if(!title)return;const btn=e.target.querySelector('button');btn.disabled=true;try{await save({type:'addTask',id:'custom-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),phase:phase(),title});render();}catch{btn.disabled=false;}}});
document.addEventListener('submit',async e=>{
 const f=e.target,read=()=>String(new FormData(f).get('name')||'').trim();
 if(f.id==='add-floor'){e.preventDefault();const name=read();if(!name)return;try{await save({type:'storageFloorAdd',id:'cf-'+Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>b.toString(16).padStart(2,'0')).join(''),label:name});render();}catch{}}
 if(f.id==='rename-floor'){e.preventDefault();const name=read();if(!name)return;try{await save({type:'storageFloorRename',id:floor,label:name});render();}catch{}}
 if(f.id==='add-bay'){e.preventDefault();const name=read();if(!name)return;const letter=nextBayLetter();if(!letter){toast('No free bay letters left.',true);return;}try{await save({type:'storageBayAdd',id:letter,name,floor});render();}catch{}}
 if(f.classList.contains('add-container')){e.preventDefault();const name=read();if(!name)return;const bay=storageBays().find(b=>b.id===f.dataset.bay);const free=bay?.items.find(x=>!x.name);if(!free){toast('This bay has no free position.',true);return;}try{await save({type:'storageSlotAssign',key:free.id,name});render();}catch{}}
 if(f.id==='add-group'){e.preventDefault();const name=read();if(!name)return;try{await save({type:'factoryGroupAdd',id:'fg-'+Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>b.toString(16).padStart(2,'0')).join(''),name});render();}catch{}}
 if(f.dataset.taskEdit){
  e.preventDefault();
  const id=f.dataset.taskEdit,fd=new FormData(f);
  const base=basePlanTasks().find(t=>t.id===id);
  const title=String(fd.get('title')||'').trim(),body=String(fd.get('body')||'').trim(),link=String(fd.get('link')||'');
  if(!title)return;
  try{
   await save({type:'taskEdit',id,title:base&&title===base.title?'':title,body:base&&body===String(base.body||'').trim()?'':body,link:link===autoTaskLink(id)?'':link});
   editingTask=null;render();
  }catch{}
 }
});
// Custom container names may have no bundled artwork; keep the tile without a broken-image glyph.
document.addEventListener('error',e=>{const t=e.target;if(t?.tagName==='IMG'&&t.classList?.contains('item-icon'))t.style.visibility='hidden';},true);
window.addEventListener('hashchange',()=>{view=['plan','factories','storage','resources','backup','profiles','wizard','account'].includes(location.hash.slice(1))?location.hash.slice(1):'plan';query='';if(state)render();window.scrollTo(0,0);});
$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){$('#detail').close();activeDetail=null;}});
window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue='';}});
function scopeHeaders(){return {'X-Save-Id':currentSave?.id||'','X-Profile-Id':currentProfile?.id||''};}
async function post(endpoint,data,scope=true,extra={}){return request(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Planner-Request':'1',...(scope?scopeHeaders():{})},body:JSON.stringify(data),...extra});}
async function loadContext(saveId,profileId){await writeQueue;const c=await request('/api/context?save='+encodeURIComponent(saveId)+'&profile='+encodeURIComponent(profileId));currentSave=c.save;currentProfile=c.profile;state=c.state;calculated=c.plan;plan=c.handbook||basePlan||plan;query='';activeDetail=null;planEditing=false;editingTask=null;factoryEditing=false;layoutEditing=false;$('#detail').close();}
function navigate(v){view=v;if(location.hash==='#'+v)render();else location.hash=v;}
function hasUnsavedNotes(){return [...document.querySelectorAll('textarea.notes')].some(el=>{const button=document.querySelector(`[data-input="${el.id}"]`);return button&&el.value!==(state.notes[button.dataset.saveNote]||'');});}
function allowSwitch(){return !hasUnsavedNotes()||confirm('You have notes that have not been saved. Leave without saving those edits?');}
function renderProfiles(){return (browserMode?browserNotice():'')+header('YOUR FACTORY WORLDS','Saves & profiles','Each save keeps separate progress for every profile. Switching back restores its checklist, deliveries and notes.')+`<div class="toolbar"><button class="btn primary" data-new-save>Create a save</button>${browserMode?'<a class="btn" href="#backup">Backups & transfer</a>':`<a class="btn" href="#account">${workspace.accountsEnabled?'Your account':'Set up user accounts'}</a>`}</div>${workspace.saves.map(s=>`<section class="panel save-panel"><div class="section-head"><h2>${esc(s.name)}</h2><button class="btn" data-new-profile="${s.id}">Try another profile</button></div><div class="profile-cards">${s.profiles.map(p=>`<article class="profile-card ${s.id===currentSave.id&&p.id===currentProfile.id?'selected':''}"><div class="eyebrow">${p.kind==='original'?'PRESERVED HANDBOOK':'CALCULATED PROFILE'}</div><h3>${esc(p.name)}</h3><p>${p.settings?`${esc(p.settings.purity)} purity · ${num(p.settings.multiplier)}× elevator · ${num(p.settings.powerFactor)}× power`:'50× elevator · pure ingots · nuclear recycling'}</p><p class="small">${p.completed} checks complete · ${phaseLabel(p.phase)}</p><button class="btn ${s.id===currentSave.id&&p.id===currentProfile.id?'':'primary'}" data-open-save="${s.id}" data-open-profile="${p.id}">${s.id===currentSave.id&&p.id===currentProfile.id?'Continue current profile':'Open profile'}</button> <button class="btn" data-duplicate-profile="${p.id}" data-duplicate-save="${s.id}">Duplicate</button> <button class="btn" data-share-profile="${p.id}" data-share-save="${s.id}">Share</button> <button class="btn" data-remove-profile="${p.id}" data-remove-save="${s.id}">Remove profile</button></article>`).join('')}</div></section>`).join('')}<p class="small muted">Duplicate copies a profile with its progress so you can try changes without touching the original. Share downloads a file with the plan, storage layout, factory groups and step edits — without your checkmarks or notes — that anyone can import under Backup → Import saves.</p><section class="panel"><h2>Rename the current save or profile</h2><form id="rename-form" class="inline-form"><select name="target" aria-label="What to rename"><option value="save">Save</option><option value="profile">Profile</option></select><input name="name" required maxlength="80" aria-label="New name" placeholder="New name"><button class="btn">Rename</button></form><p class="small muted">Renaming does not change progress. Profiles keep a frozen calculation so later planner updates cannot silently change your targets.</p></section>`;}
const option=(value,label,selected)=>`<option value="${value}" ${value===String(selected)?'selected':''}>${label}</option>`;
function help(key){return helpText[key]?`<span class="setting-help" tabindex="0" aria-label="${esc(helpText[key])}">ⓘ<span role="tooltip">${esc(helpText[key])}</span></span>`:'';}
const power= mw=>num(mw>1000?mw/1000:mw)+(mw>1000?' GW':' MW');
function altPickerHtml(s){
 const picked=new Set(s.alternateRecipes||[]);
 const list=workspace.catalog.alternates||[];
 return `<div class="alt-picker"><div class="alt-picker-head"><b>Alternate recipes · ${picked.size} selected</b><span class="alt-tools"><button type="button" class="btn quiet" data-alt-best title="Recalculates with every alternate allowed and ticks only the recipes the optimal plan uses">Planner’s choice</button><button type="button" class="btn quiet" data-alt-all>Select all</button><button type="button" class="btn quiet" data-alt-none>Clear all</button></span><input id="alt-filter" type="search" placeholder="Filter by recipe or product…" aria-label="Filter alternate recipes"></div><p class="small muted">Only the recipes you tick are allowed in the plan. Hard-drive alternates are unlocked from crash sites; Turbofuel and Compacted Coal are researched in the MAM instead. Recipes your other choices depend on are selected automatically: a turbofuel-based power route locks its MAM recipes, and requiring pure ingots locks the pure recipes. Raw-resource conversion recipes are not alternates — they follow the SAM conversion setting and Tier 9 unlocks. Selecting none plans with standard recipes only. <b>Planner’s choice</b> recalculates with every alternate allowed and ticks only the recipes the optimal plan actually uses — each ticked recipe costs one hard drive. Select all and Clear all apply to the rows currently shown by the filter.</p><p class="alt-force-hint"><span class="alt-force-star">★</span><span><b>Force a recipe:</b> tick it, then click its star. The plan will use <b>no other recipe</b> for that product once the starred one is available.</span></p><div class="alt-list">${list.map(a=>{const outs=Object.keys(a.outputs);const why=a.mam&&!['auto','coal','fuel'].includes(s.mainPower||'auto')?'power preference':a.pure&&s.pureIngots===true?'ingot preference':'';const pref=new Set(s.preferredRecipes||[]);return `<div class="alt-row" data-alt-text="${esc((a.name+' '+outs.join(' ')).toLowerCase())}"><label class="check-row">${why?`<input type="checkbox" checked disabled aria-label="${esc(a.name)} is required by your ${why}">`:`<input type="checkbox" name="alt" value="${esc(a.id)}" ${picked.has(a.id)?'checked':''}>`}<span>${esc(a.name)}<small class="muted"> · ${esc(outs.join(', '))} · ${a.mam?'MAM research':'Phase '+a.phase}${why?' · required by your '+why:''}</small></span></label>${why?'':`<label class="alt-pref" title="Force this recipe: the plan will not use any other recipe for ${esc(outs[0])} once this one is available"><input type="checkbox" name="altpref" value="${esc(a.id)}" ${pref.has(a.id)?'checked':''} ${picked.has(a.id)?'':'disabled'} aria-label="Force ${esc(a.name)} as the only ${esc(outs[0])} recipe"><span>★</span></label>`}<button type="button" class="btn quiet alt-info" data-alt-info="${esc(a.id)}" aria-label="Show the ${esc(a.name)} recipe">recipe ↗</button></div>`;}).join('')}</div></div>`;
}
// MAM recipes (Turbofuel, Compacted Coal) appear in plans with alternate:false, so match catalog ids too.
const alternatesUsed=plan=>{const altIds=new Set((workspace?.catalog?.alternates||[]).map(a=>a.id));return [...new Set(Object.values(plan?.stages||{}).flatMap(st=>(st.rows||[]).filter(r=>r.alternate||altIds.has(r.id)).map(r=>r.id)))].sort();};
function openAltRecipe(id){
 const a=(workspace.catalog.alternates||[]).find(x=>x.id===id);if(!a)return;
 const primary=Object.keys(a.outputs)[0];
 const standards=(workspace.catalog.standardRecipes||[]).filter(r=>r.outputs[primary]);
 const panel=rc=>recipePanelHtml({machineCount:1,recipe:{name:rc.name.replace('Alternate: ',''),machine:rc.machine,ins:Object.entries(rc.inputs||{}),outs:Object.entries(rc.outputs||{})}});
 dialog(a.name,a.mam?`MAM research · unlocked in the MAM, not from hard drives · ${esc(a.machine)}`:`Alternate recipe · available from Phase ${a.phase} · ${esc(a.machine)}`,`${panel(a)}${standards.length?`<h3>Standard ${standards.length>1?'recipes':'recipe'} for ${esc(primary)}</h3>${standards.map(panel).join('')}`:`<p class="small muted">No standard recipe produces ${esc(primary)}.</p>`}<p class="small muted">Rates are per machine at 100%, per minute. Alternates are unlocked with hard drives in game; ticking a recipe is a planning allowance, not an in-game unlock.</p>`,primary);
}
function field(label,key,value,type='number',extra=''){return `<label class="field">${label} ${help(key)}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function selectField(label,key,options,value){return `<label class="field">${label} ${help(key)}<select name="${key}">${options.map(([v,l])=>option(v,l,value)).join('')}</select></label>`;}
function startWizard(saveId=null){if(!allowSwitch())return;const existing=workspace.saves.find(s=>s.id===saveId);const selected=existing?.profiles.find(p=>p.id===existing.activeProfile);const previous=selected?.settings||(selected?.kind==='original'?{phase:'3',purity:'pure',distribution:'randomized',multiplier:50,powerFactor:0.5,availablePowerGW:0,recipes:'all',pureIngots:true,sam:'needed',nuclear:'recycle',uraniumReactors:1,storage:'all',storageRate:1,cellsPerMinute:20,goal:'timed',hours:8,roundRates:true,wholeMachines:true,limitsConfirmed:false,limits:{...workspace.catalog.pureLimits}}:null);wizard={step:1,saveId,saveName:existing?.name||'',name:'',settings:previous?structuredClone(previous):{phase:'3',purity:'vanilla',distribution:'original',multiplier:1,powerFactor:1,availablePowerGW:0,recipes:'standard',pureIngots:false,sam:'needed',nuclear:'none',uraniumReactors:1,storage:'construction',storageRate:1,cellsPerMinute:0,goal:'balanced',hours:8,roundRates:true,wholeMachines:true,limitsConfirmed:false,limits:{...workspace.catalog.limits}},preview:null};if(browserMode&&!previous)wizard.settings.phase='1';navigate('wizard');}
function renderWizard(){
 if(!wizard)return header('NEW PROFILE','Choose a save first')+'<button class="btn primary" data-new-save>Create a save</button><a class="btn" href="#profiles">Existing saves</a>';
 const w=wizard,s=w.settings;let content='';
 if(w.step===1)content=`<h2>Your save and game settings</h2><p>Use the settings shown in your game. Values are multipliers: half consumption is 0.5.</p><div class="form-grid">${field('Save name','saveName',w.saveName,'text','required maxlength="80" '+(w.saveId?'readonly':''))}${selectField('Currently working on','phase',['1','2','3','4','5'].map(x=>[x,'Phase '+x]),s.phase)}${selectField('Resource purity','purity',purities,s.purity)}${selectField('Node distribution','distribution',distributions,s.distribution)}${field('World seed (optional)','worldSeed',s.worldSeed||'','number','min="-2147483648" max="2147483647" step="1"')}${field('Elevator requirement multiplier','multiplier',s.multiplier,'number','min="0.1" max="1000" step="0.1" required')}${field('Power consumption multiplier','powerFactor',s.powerFactor,'number','min="0" max="10" step="0.1" required')}${field('Spare existing power (MW)','availablePowerMW',s.availablePowerGW*1000,'number','min="0" max="10000000" step="1" required')}${field('Other settings / mod notes','modNotes',s.modNotes||'','text','maxlength="500"')}</div><p class="small muted">Other settings are notes only. Modified recipes, production boosts and modded items are not simulated. Phase plans assume the necessary milestones and MAM research are unlocked by commissioning.</p>`;
 if(w.step===2)content=`<h2>How do you want to build?</h2><div class="form-grid">${selectField('Recipe access','recipes',[['standard','Standard recipes'],['all','Allow all alternate recipes as they become available'],['custom','Pick specific alternate recipes']],s.recipes)}${selectField('Ingot factories','pureIngots',[['false','Let the planner choose'],['true','Require pure ingot recipes when unlocked']],String(s.pureIngots))}${selectField('SAM resource conversion','sam',[['avoid','Avoid ore / gas conversion'],['needed','Only to meet resource limits or improve maximum output'],['allow','Allow whenever useful']],s.sam)}${field('Extra utilities power (%)','utilityPercent',s.utilityPercent??20,'number','min="0" max="200" step="1" required')}${selectField('Drone fuel','droneFuel',droneFuels.map(n=>[n,n==='none'?'No dedicated drone fuel':n]),s.droneFuel||'none')}${field('Drone fuel supply (items/min, entire fleet)','droneFuelRate',s.droneFuelRate??10,'number','min="0.01" max="10000" step="any" required')}${field('Phase 4 battery bridge /min (ionized fuel only)','droneBridgeRate',s.droneBridgeRate??10,'number','min="0.01" max="10000" step="any" required')}${selectField('Preferred main power','mainPower',powerOptions,s.mainPower||'auto')}${selectField('Nuclear goal','nuclear',[['none','No nuclear power'],['sink','Uranium power; sink plutonium fuel rods'],['recycle','Full waste recycling in Phase 5']],s.nuclear)}${field('Minimum uranium reactors from Phase 4','uraniumReactors',s.uraniumReactors,'number','min="1" max="1000" step="1" required')}${selectField('Storage supply','storage',storageOptions,s.storage)}${selectField('Collectables storage','collectables',[['false','No collectables bays'],['true','Include leaves, wood, slugs, food, protein and DNA']],String(s.collectables??(s.storage==='all')))}${field('Protected storage refill per item /min','storageRate',s.storageRate,'number','min="0.1" max="300" step="0.1" required')}${field('Extra Singularity Cells /min in Phase 5','cellsPerMinute',s.cellsPerMinute,'number','min="0" max="1000" step="0.1" required')}</div>${s.recipes==='custom'?altPickerHtml(s):''}<div class="notice blue">SAM conversion controls raw resource conversion, not SAM ingredients required by late-game parts. Pure recipes still need unlocking. Gathered items get storage positions but cannot have an unlimited automatic source.</div><p class="small muted">Each Main Portal consumes <b>2 Singularity Cells/min</b> to maintain its connection; the Satellite Portal does not consume cells. <b>10/min supplies five connections</b> (the standard recipe produces 10/min). Reserve portal operating power separately. <a href="https://satisfactory.wiki.gg/wiki/Portal" target="_blank" rel="noreferrer">Portal reference</a>. Nuclear waste and unpackaged fluids stay outside the storage room.</p>`;
 if(w.step===3){const recommended=s.multiplier>5?'timed':'balanced';content=`<h2>Choose your production goal</h2><p>${s.multiplier>5?'Your elevator multiplier makes completion time a useful starting point.':'Balanced progression is a practical starting point for these settings.'} Storage and your selected preferences apply to every option.</p><div class="goal-grid">${workspace.catalog.goals.map(g=>`<label class="goal-card"><input type="radio" name="goal" value="${g.id}" ${s.goal===g.id?'checked':''}><strong>${g.name}</strong>${recommended===g.id?'<span class="badge orange">Suggested</span>':''}<p>${g.description}</p></label>`).join('')}</div><div class="form-grid">${field('Profile name','profileName',w.name||workspace.catalog.goals.find(g=>g.id===s.goal).name,'text','required maxlength="80"')}${field('Hours per phase (target-time option)','hours',s.hours,'number','min="0.25" max="2000" step="0.25" required')}</div><label class="check-row"><input type="checkbox" name="roundRates" ${s.roundRates?'checked':''}>Round delivery rates to convenient numbers (may change completion time)</label><label class="check-row"><input type="checkbox" name="wholeMachines" ${s.wholeMachines!==false?'checked':''}>Run solid-part machines at 100%; send surplus to storage, then the sink</label><p class="small muted">Inputs and byproducts are recalculated. Fluid, generator and nuclear/recycling lines may still need balancing. Recipe choices are selected first, then whole-machine counts are fitted within your budgets.</p><p class="small muted">Maximum output means fastest simultaneous elevator completion, within your resource budgets. It does not maximize sink points. Rounding is ignored for maximum output.</p>`;}
 if(w.step===4)content=`<h2>Available resource budgets</h2><p>Enter the extraction you can allocate to this new plan, per minute, after existing factories and power fuel. Starter values are full-map estimates at endgame extraction, not resources already connected.</p><div class="notice blue">${esc(resourceDefaults(s.purity,s.distribution).description)} ${s.worldSeed?'Recorded seed: '+esc(s.worldSeed)+'. ':''}<a href="https://satisfactoryworldseed.com/" target="_blank" rel="noreferrer">Look up your seed totals</a> · <a href="https://satisfactory.wiki.gg/wiki/Resource_Node" target="_blank" rel="noreferrer">Node reference</a>. Resource-rich counts cannot be filled accurately without your seed: enter the lookup totals below. Oil-well extraction may be added after its unlock.</div><div class="resource-inputs">${workspace.catalog.raw.map(n=>field(n,'limit:'+n,s.limits[n],'number','min="0" max="10000000" step="any" required')).join('')}</div><label class="check-row"><input name="limitsConfirmed" type="checkbox" ${s.limitsConfirmed?'checked':''}>I have checked these budgets for my save (required for maximum output)</label>`;
 if(w.step===5){const p=w.preview;content=`<h2>Review ${esc(w.name)}</h2><p>Nothing has been created yet. Your other profiles and their progress stay intact.</p><div class="table-wrap"><table><thead><tr><th>Phase</th><th>Delivery time</th><th>Buildings</th><th>New generation</th><th>Budget</th></tr></thead><tbody>${Object.entries(p.stages).map(([ph,x])=>`<tr><td>${ph}</td><td>${x.hours?num(x.hours)+' h':'—'}</td><td>${x.rows?num(x.rows.reduce((a,r)=>a+r.machines,0)):'—'}</td><td>${x.generationMW!==undefined?power(x.generationMW):'—'}</td><td>${x.feasible?'Within entered limits':'Needs adjustment'}</td></tr>`).join('')}</tbody></table></div>${Object.entries(p.stages).filter(([,x])=>!x.feasible).map(([ph,x])=>`<div class="notice"><b>Phase ${ph}:</b> ${esc(x.reason)}${draftOptions(x,p.settings)}</div>`).join('')}<details class="panel"><summary>Assumptions and calculation limits</summary>${p.warnings.map(x=>`<p class="small">${esc(x)}</p>`).join('')}</details><p class="small muted">You can save a plan that exceeds your budgets as a planning draft; its affected phases remain clearly flagged. Profiles are calculated snapshots. Create another profile to compare different settings.</p>`;}
 return (browserMode?browserNotice():'')+header('SAVE → SETTINGS → GOALS → PLAN',w.saveId?'Add a profile to '+esc(w.saveName):'Create your factory plan')+`<div class="wizard-progress">${['Game settings','Preferences','Goals','Resources','Review'].map((n,i)=>`<button type="button" class="${w.step===i+1?'current':''}" data-wizard-step="${i+1}" ${w.step===i+1?'aria-current="step"':''}>${i+1}. ${n}</button>`).join('')}</div><form id="wizard-form" class="panel wizard-panel">${content}<div class="wizard-actions"><button type="button" class="btn" ${w.step===1?'data-cancel-wizard':'data-wizard-back'}>${w.step===1?'Cancel':'Back'}</button><button class="btn primary" type="submit">${w.step===5?'Create profile':w.step===4?'Calculate plan':'Continue →'}</button></div><p id="wizard-error" class="form-error" role="alert"></p></form>`;
}
function readWizard(form){const f=new FormData(form),w=wizard,s=w.settings,oldPreset=s.purity+'|'+s.distribution;for(const [k,v]of f){if(k==='availablePowerMW')s.availablePowerGW=Number(v)/1000;if(k==='saveName')w.saveName=v;if(k==='profileName')w.name=v;else if(k.startsWith('limit:'))s.limits[k.slice(6)]=Number(v);else if(['utilityPercent','droneFuelRate','droneBridgeRate','multiplier','powerFactor','availablePowerGW','uraniumReactors','storageRate','cellsPerMinute','hours'].includes(k))s[k]=Number(v);else if(k==='collectables')s.collectables=v==='true';else if(k==='pureIngots')s[k]=v==='true';else if(['phase','purity','distribution','recipes','sam','nuclear','storage','goal','modNotes','mainPower','worldSeed','droneFuel'].includes(k))s[k]=v;}
 if(form.querySelector('.alt-list')){s.alternateRecipes=f.getAll('alt').map(String);s.preferredRecipes=f.getAll('altpref').map(String).filter(id=>s.alternateRecipes.includes(id));}
 if(w.step===3){s.roundRates=f.has('roundRates');s.wholeMachines=f.has('wholeMachines');}if(w.step===4)s.limitsConfirmed=f.has('limitsConfirmed');
 if(w.step===1&&oldPreset!==s.purity+'|'+s.distribution){s.limits=resourceDefaults(s.purity,s.distribution).limits;s.limitsConfirmed=false;}
 w.preview=null;
}
function authForm(mode){return `<form id="auth-form" class="panel auth-panel"><h2>${mode==='setup'?'Secure your existing save':mode==='register'?'Create your account':'Sign in'}</h2>${mode==='setup'?'<p>Your existing save and progress will belong to this account. Once enabled, visitors must sign in.</p><label class="field">Server setup token<input name="setupToken" required autocomplete="off"></label><p class="small muted">Read account-setup-token.txt in the server data folder. With Docker: docker compose exec planner cat /data/account-setup-token.txt</p>':''}${field('Username','username','','text','required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" autocomplete="username"')}${field('Password (12–128 characters)','password','','password','required minlength="12" maxlength="128" autocomplete="'+(mode==='login'?'current-password':'new-password')+'"')}${mode==='setup'?'<label class="check-row"><input type="checkbox" name="registration">Allow other people to register their own accounts</label>':''}<button class="btn primary">${mode==='setup'?'Enable accounts':mode==='register'?'Create account':'Sign in'}</button><p id="auth-error" class="form-error" role="alert"></p></form>`;}
function renderAccount(){if(browserMode)return renderBrowserBackup();return header('YOUR ACCOUNT',workspace.accountsEnabled?esc(workspace.user.username):'User accounts',workspace.accountsEnabled?'Your saves are visible only to your account.':'Local mode currently shares one workspace. Enable accounts before sharing this server.')+(workspace.accountsEnabled?'<section class="panel"><p>Each account has its own named saves, profiles and progress.</p><button class="btn" data-logout>Sign out</button><p class="small muted">Use HTTPS when serving this app beyond localhost. Your host manages account access and backups.</p></section>':authForm('setup'));}
function renderSignedOut(){state=null;$('#app').innerHTML=`<main class="signin"><div class="brand"><img src="./favicon.svg" alt="">Project Assembly</div><h1>Your factory notebook</h1>${authForm(authMode)}${workspace.registration?`<button class="btn quiet" data-auth-mode="${authMode==='login'?'register':'login'}">${authMode==='login'?'Create an account':'Back to sign in'}</button>`:''}</main>`;}
const calcStage=()=>calculated.stages[stage()];
function calculatedDelivery(id){const d=Object.entries(calcStage().delivery||{}).find(([n])=>id===stage()+'-'+slug(n));return d?{id,name:d[0],...d[1],initial:0}:null;}
let wizardBusy=false;
// The public edition reports each phase from the calculator worker; the server edition shows the static label.
const calcProgress=(button,label)=>{if(button)button.textContent=label;return {onProgress:phase=>{if(button)button.textContent=`${label} Phase ${phase} of 5…`;}};};
function wizardError(form,err){
 const el=form?.querySelector('.form-error');if(!el){toast(err.message,true);return;}
 if(/timed out/i.test(err.message))el.innerHTML=`${esc(err.message)}<span class="error-options"><b>Ways to get a plan:</b><span>Try again — speed varies with your device and other open tabs.</span><span>In the recipe picker, use <b>Planner’s choice</b> or untick alternates you don’t need; many recipes for the same product slow the search the most.</span><span>In Goals, turn off whole-machine production — exact balancing calculates much faster.</span><span>Lower the elevator multiplier or allow more hours per phase.</span></span>`;
 else el.textContent=err.message;
}
async function moveWizard(target){
 if(wizardBusy||!wizard||target===wizard.step||target<1||target>5)return;
 const form=$('#wizard-form');if(target>wizard.step&&!form.reportValidity())return;
 readWizard(form);
 if(target!==5){wizard.step=target;render();return;}
 wizardBusy=true;const buttons=document.querySelectorAll('[data-wizard-step],#wizard-form button');buttons.forEach(b=>b.disabled=true);
 const submit=form.querySelector('button[type="submit"]'),label=submit?.textContent;
 try{wizard.name=wizard.name.trim()||workspace.catalog.goals.find(g=>g.id===wizard.settings.goal).name;wizard.preview=await post('/api/preview',{settings:wizard.settings},true,calcProgress(submit,'Calculating…'));wizard.step=5;render();}
 catch(err){wizardError(form,err);if(submit)submit.textContent=label;}
 finally{wizardBusy=false;buttons.forEach(b=>b.disabled=false);}
}
function calcTasks(){const p=calcStage(),g=progression(calculated,state,progressionData,phase());const startup=stage()==='1'?[g.baseTasks[0],...g.powerTasks.slice(0,2),...g.baseTasks.slice(1,5),...g.milestoneTasks,...g.powerTasks.slice(2),...g.baseTasks.slice(5)]:[...g.powerTasks,...g.milestoneTasks];return [...startup,...g.hardDrives,...(p.rows||[]).map(r=>({id:'calc-'+stage()+'-'+r.id,title:r.name,body:`${machineSetup(r).summary} ${machineSetup(r).partial?'Adjustable machine: ≈ '+num(machineSetup(r).clock)+'% → ≈ '+machineSetup(r).lastOutput+'. Open factory details for an easier rounded option.':'Each machine: '+machineSetup(r).fullOutput+'.'} Inputs /min: ${Object.entries(r.inputs).map(([n,q])=>n+' '+num(q)).join(', ')||'none'}. Outputs /min: ${Object.entries(r.outputs).map(([n,q])=>n+' '+num(q)).join(', ')||power(r.generationMW)}.`})),{id:'calc-'+stage()+'-storage',title:'Connect protected storage and overflow',body:'Reserve the listed storage refill rates before elevator exports. Handle every liquid byproduct; send surplus sinkable solids to the AWESOME Sink after unlocking it.'}];}
// Older snapshots carry only a reason sentence; shortfalls/minHours render as concrete options when present.
function draftOptions(x,s){
 const fixes=[];
 if(x.shortfalls?.length)fixes.push(`Raise the short budget${x.shortfalls.length>1?'s':''} (Resources): ${x.shortfalls.map(f=>`${esc(f.name)} to about ${num(f.needed)}/min (entered: ${num(f.budget)}/min)`).join('; ')}.`);
 if(x.wholeMachinesOnly)fixes.push('Keep these budgets instead: untick “Run solid-part machines at 100%” (Goals). Precise balancing fits, with one adjustable machine per production line.');
 if(x.minHours)fixes.push(s?.goal==='timed'?`Raise “Hours per phase” (Goals) to at least ${num(x.minHours)} h.`:`Switch the goal (Goals) to “Target completion time” with at least ${num(x.minHours)} hours per phase.`);
 else if(x.shortfalls?.length&&!x.wholeMachinesOnly)fixes.push(s?.goal==='maximum'?'Lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences).':`More time alone will not fit: lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences)${s?.roundRates?', or untick delivery-rate rounding (Goals)':''}.`);
 if(x.shortfalls?.length&&s?.recipes==='standard')fixes.push('Allow alternate recipes (Preferences) to cut raw resource use.');
 if(x.shortfalls?.length&&s?.sam==='avoid')fixes.push('Allow SAM resource conversion (Preferences) to turn plentiful resources into the short ones.');
 return fixes.length?`<p><b>Options</b></p><ul>${fixes.map(f=>`<li>${f}</li>`).join('')}</ul>`:'';
}
function calcWarnings(){const x=calcStage();const options=x.feasible?'':draftOptions(x,calculated?.settings);return `${!x.feasible?`<div class="notice"><b>Planning draft — resource budget exceeded or recipe combination unavailable.</b> ${esc(x.reason)}${options&&options+'<p class="small">Profiles are calculated snapshots: create a new profile with adjusted settings to apply an option.</p>'}</div>`:''}${x.additionalHeadroomMW>0.01?`<div class="notice">Allow another ${power(x.additionalHeadroomMW)} for whole-building power headroom. Phase 1 needs biomass or existing generation.</div>`:''}`;}
function renderCalculatedPlan(){const x=calcStage(),ts=planTasks(),done=ts.filter(t=>checked(t.id)).length;return header('CALCULATED BUILD SEQUENCE',phaseLabel(phase()),esc(currentProfile.name))+calcWarnings()+`<div class="stats">${stat('Progress',done+'/'+ts.length,'Checklist steps')}${stat('Delivery time',num(x.hours)+' h','At steady state; excludes construction')}${stat('Buildings',num(x.rows?.reduce((a,r)=>a+r.machines,0)),'Includes new power generation')}${stat('New power',power(x.generationMW),'Existing spare power is separate')}</div>${phase()==='post'?'<div class="notice blue">Retain these Phase 5 capacities. Prioritize storage and teleporter supply; reduce former elevator exports as needed and sink spare parts.</div>':''}<div class="split"><section><div class="section-head"><h2>Build sequence</h2>${planEditToolbar()}</div><p class="small muted">Start with construction stock and currently available power. Mark HUB, MAM and recipe unlocks as you complete them; these carry across phases. Milestone cost guidance updates from factories marked running. Full-phase factory targets follow the startup and unlock steps.</p><div class="checklist">${ts.map(taskHtml).join('')||'<div class="empty-state">Every step of this phase is removed. Use Removed steps below to restore them.</div>'}</div>${removedStepsHtml()}<form id="add-task" class="inline-form"><input name="title" maxlength="240" required placeholder="Add a task…" aria-label="Personal task"><button class="btn">Add task</button></form><h2>Phase notes</h2><textarea id="phase-note" class="notes" maxlength="6000">${esc(state.notes['phase-'+phase()]||'')}</textarea><button class="btn" data-save-note="phase-${phase()}" data-input="phase-note">Save notes</button></section><aside><section class="panel"><h2>Elevator delivery</h2>${Object.entries(x.delivery||{}).map(([n,d])=>deliveryHtml({id:stage()+'-'+slug(n),name:n,...d,initial:0})).join('')}</section><section class="panel"><h2>Profile assumptions</h2>${calculated.warnings.map(w=>`<p class="small">${esc(w)}</p>`).join('')}</section></aside></div>`;}
function calcFactoryCard(r,groupId=null){
 const total=Object.values(r.outputs||{})[0]||0;
 return `<article class="factory-card"><div class="card-top"><span class="card-icon">${itemIcon(Object.keys(r.outputs)[0])}</span><div class="card-main"><button class="name" data-calc-factory="${r.id}">${esc(r.name)}</button><div class="output">${num(r.machines)} <span>${esc(r.machine)}</span></div></div></div><p>${Object.entries(r.outputs).map(([n,q])=>`${esc(n)}: ${num(q)}/min`).join('<br>')||power(r.generationMW)}</p>${groupId?allocationHtml(r.id,groupId,total||r.generationMW,r.machines,total?'/min':' MW'):''}<footer><label class="check-row"><input type="checkbox" data-check="calc-${stage()}-${r.id}" ${doneAttr('calc-'+stage()+'-'+r.id)}>Running</label><button class="btn quiet" data-calc-factory="${r.id}">Details ↗</button></footer>${factoryEditing?assignEditor(r.id):''}</article>`;
}
function renderCalculatedFactories(){const x=calcStage(),rows=(x.rows||[]).filter(r=>(r.name+' '+Object.keys(r.outputs).join(' ')).toLowerCase().includes(query.toLowerCase()));
 const ungrouped=rows.filter(r=>!membershipsOf(r.id).length);
 const groupsHtml=groupSections(rows,r=>r.id,(r,gid)=>calcFactoryCard(r,gid));
 return header('CALCULATED PRODUCTION','Factory targets','Each recipe line includes its inputs, whole buildings and later expansion. Multiple recipes for a part can share one site.')+(!calculated.settings.wholeMachines?'<div class="notice blue">Prefer extra production over underclocking? <button class="btn primary" data-round-up>Round up production</button><p>Creates a recalculated profile revision. Your previous profile stays available; increased factory requirements are marked for review.</p></div>':'<div class="notice blue">Whole-machine production: protect downstream supply first, refill storage, then sink surplus solids. Liquid and nuclear balances remain controlled.</div>')+calcWarnings()+`<div class="toolbar"><input id="factory-search" class="search" aria-label="Find a factory" placeholder="Find a part or recipe…" value="${esc(query)}"><span>${rows.length} production lines</span>${factoryEditToolbar()}</div>${factoryEditing?groupEditPanel():''}${groupsHtml}${groupsHtml&&ungrouped.length?'<p class="eyebrow">UNGROUPED PRODUCTION LINES</p>':''}<div class="cards">${ungrouped.map(r=>calcFactoryCard(r)).join('')}</div>`;}
function machineSetup(r){
 const equivalent=r.equivalent||r.machines-1+r.lastClock/100,whole=Math.floor(equivalent+1e-7),fraction=Math.max(0,equivalent-whole),partial=fraction>1e-7;
 const rates=Object.fromEntries(Object.entries(r.outputs||{}).map(([n,q])=>[n,q/equivalent]));
 const fullOutput=Object.entries(rates).map(([n,q])=>`${num(q)} ${n}/min`).join(' · ')||`${num(r.generationMW/equivalent)} MW`;
 const lastOutput=Object.entries(rates).map(([n,q])=>`${num(q*fraction)} ${n}/min`).join(' · ')||`${num(r.generationMW/equivalent*fraction)} MW`;
 const summary=`${r.machines} ${r.machine} total: ${partial?(whole?whole+' at 100% + ':'')+'1 adjustable machine':whole+' at 100% (no underclock needed)'}.`;
 const sensitive=/uranium|plutonium|ficsonium|waste|non-fissile/i.test([r.name,...Object.keys(r.inputs||{}),...Object.keys(r.outputs||{})].join(' '));
 let easy=null;
 if(partial&&!sensitive){
  // Round the final clock upward to a whole percent, never silently underproduce.
  let clock=Math.ceil(fraction*100-1e-7);
  const primary=Object.entries(rates)[0];
  if(primary){const target=Math.ceil(primary[1]*fraction-1e-7),candidate=target/primary[1]*100;if(candidate<=100&&Math.abs(candidate-Math.round(candidate))<1e-7)clock=Math.max(clock,Math.round(candidate));}
  const extra=clock/100-fraction;
  if(extra>1e-7)easy={clock,output:Object.fromEntries(Object.entries(rates).map(([n,q])=>[n,q*clock/100])),inputs:Object.fromEntries(Object.entries(r.inputs||{}).map(([n,q])=>[n,q/equivalent*extra])),extraOutputs:Object.fromEntries(Object.entries(rates).map(([n,q])=>[n,q*extra]))};
 }
 return {summary,whole,partial,fullOutput,lastOutput,clock:fraction*100,easy};
}
function setupHtml(r){const m=machineSetup(r);return `<h3>Machine setup</h3><p><b>${esc(m.summary)}</b></p><table><thead><tr><th>Machines</th><th>Clock each</th><th>Output per machine</th></tr></thead><tbody>${m.whole?`<tr><td>${m.whole} full-speed</td><td>100%</td><td>${esc(m.fullOutput)}</td></tr>`:''}${m.partial?`<tr><td>1 adjustable</td><td>≈ ${num(m.clock)}%</td><td>≈ ${esc(m.lastOutput)}</td></tr>`:''}</tbody></table>${m.easy&&!calculated?.settings.wholeMachines?`<div class="notice blue"><b>Easier optional setting: set only the adjustable machine to ${m.easy.clock}%.</b><p>Its output: ${inputText(m.easy.output)||num(r.generationMW/(r.equivalent||1)*m.easy.clock/100)+' MW'}.</p><p>Extra inputs needed: ${inputText(m.easy.inputs)}.<br>Extra outputs/byproducts: ${inputText(m.easy.extraOutputs)||'Additional generation'}.</p><p>This is extra capacity, not a recalculated balanced plan. Supply the extra inputs and handle every extra output before using it. The totals below remain the original calculated targets.</p></div>`:''}${m.partial?'<p class="small muted">Calculated percentages and outputs are displayed rounded. Keep the calculated setting for tightly balanced recycling; do not round nuclear or waste-processing lines independently.</p>':''}`;}
function openCalculatedFactory(id){const r=calcStage().rows?.find(r=>r.id===id);if(!r)return;const flow=calcFlowModel(r);const dialogIcon=Object.keys(r.outputs||{})[0]||'';dialog(r.name,phaseLabel(phase()),`${flowHtml(flow)}${setupHtml(r)}${laneAdviceHtml(flow)}<h3>Outputs per minute</h3><p>${inputText(r.outputs)||power(r.generationMW)}</p><h3>Expansion by phase</h3><table><thead><tr><th>Phase</th><th>Machines</th><th>Add</th></tr></thead><tbody>${(()=>{let installed=0;return Object.entries(calculated.stages).map(([ph,p])=>{const x=p.rows?.find(x=>x.id===id),required=x?.machines||0,add=Math.max(0,required-installed);installed=Math.max(installed,required);return `<tr><td>${ph}</td><td>${required}</td><td>${add?'+'+add:'Keep available'}</td></tr>`;}).join('');})()}</tbody></table><p class="small muted">The optimizer may choose a different recipe in another phase. Keep earlier buildings until the replacement chain runs. Screws and wire can be made beside consumers.</p><textarea id="detail-note" class="notes" maxlength="6000" aria-label="Factory notes">${esc(state.notes['factory-'+id]||'')}</textarea><button class="btn" data-save-note="factory-${id}" data-input="detail-note">Save notes</button>`,dialogIcon);}
function renderCalculatedResources(){const x=calcStage();return header('CHECK BEFORE EXPANDING','Power & resources','New production and new generator fuel are included. Existing fuel consumption must already be deducted from your entered budgets.')+calcWarnings()+`<div class="stats">${stat('New generation',power(x.generationMW),'Fuel and recycling included')}${stat('Whole-machine peak',power(x.peakMW),'At selected consumption multiplier')}${stat('With utility allowance',power(x.requiredMW),(calculated.settings.utilityPercent??20)+'% for transport and utilities; verify actual load')}${stat('Existing spare power',power(calculated.settings.availablePowerGW*1000),'Not total installed generation')}</div><div class="table-wrap"><table><thead><tr><th>Resource</th><th>Required /min</th><th>Budget /min</th><th>Remaining</th></tr></thead><tbody>${workspace.catalog.raw.map(n=>`<tr><td>${esc(n)}</td><td>${num(x.raw?.[n])}</td><td>${num(calculated.settings.limits[n])}</td><td class="${(x.raw?.[n]||0)>calculated.settings.limits[n]?'warn':''}">${num(calculated.settings.limits[n]-(x.raw?.[n]||0))}</td></tr>`).join('')}</tbody></table></div><div class="backup-grid"><section class="panel"><h2>Dedicated drone fuel /min</h2><p>${inputText(x.drone||{})||'No dedicated drone fuel in this phase.'}</p><h2>Protected storage /min</h2><p>${inputText(x.storage||{})||'No storage production requested.'}</p></section><section class="panel"><h2>Conversion and byproducts</h2><p>${x.conversions?.map(esc).join('<br>')||'No raw-resource conversion required.'}</p><p>Plutonium rods to sink: ${num(x.plutoniumSink)}/min.</p><p>Surplus solids: ${inputText(x.surplus||{})||'None'}</p><p class="small muted">Liquid and radioactive material balances are enforced. Do not let storage or overflow block recycling.</p></section></div>`;}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-new-save'))startWizard();
 if(b.dataset.newProfile)startWizard(b.dataset.newProfile);
 if(b.dataset.calcFactory)openCalculatedFactory(b.dataset.calcFactory);
 if(b.dataset.groupChain)openGroupChain(b.dataset.groupChain);
 if(b.dataset.altInfo)openAltRecipe(b.dataset.altInfo);
 if(b.hasAttribute('data-alt-all')||b.hasAttribute('data-alt-none')){
  const on=b.hasAttribute('data-alt-all'),p=b.closest('.alt-picker');
  for(const box of p.querySelectorAll('.alt-row:not([hidden]) input[name=alt]')){box.checked=on;const star=box.closest('.alt-row').querySelector('input[name=altpref]');if(star){star.disabled=!on;if(!on)star.checked=false;}}
  p.querySelector('.alt-picker-head b').textContent=`Alternate recipes · ${p.querySelectorAll('input[name=alt]:checked').length} selected`;
 }
 if(b.hasAttribute('data-alt-best')&&wizard&&!b.disabled){
  b.disabled=true;const label=b.textContent;
  try{
   readWizard($('#wizard-form'));
   const preview=await post('/api/preview',{settings:{...wizard.settings,recipes:'all'}},true,calcProgress(b,'Calculating…'));
   wizard.settings.alternateRecipes=alternatesUsed(preview);
   render();
   toast(`Selected ${wizard.settings.alternateRecipes.length} alternate recipes the planner uses with your current settings.`);
  }catch(err){wizardError($('#wizard-form'),err);b.disabled=false;b.textContent=label;}
 }
 if(b.hasAttribute('data-round-up')){if(!allowSwitch())return;b.disabled=true;try{await writeQueue;const r=await post('/api/round-up',{},true,calcProgress(b,'Recalculating…'));workspace=r.workspace;await loadContext(r.saveId,r.profileId);render();toast('Created rounded profile. '+r.reviewCount+' completed factory checks need review; previous progress is preserved.');}catch(err){toast(err.message,true);b.disabled=false;b.textContent='Round up production';}}
 if(b.dataset.duplicateProfile){if(!allowSwitch())return;b.disabled=true;b.textContent='Copying…';try{await writeQueue;const r=await post('/api/duplicate-profile',{saveId:b.dataset.duplicateSave,profileId:b.dataset.duplicateProfile});workspace=r.workspace;await loadContext(r.saveId,r.profileId);navigate('plan');toast('Copy created and opened. Changes here leave the original profile untouched.');}catch(err){toast(err.message,true);b.disabled=false;b.textContent='Duplicate';}}
 if(b.dataset.shareProfile){b.disabled=true;try{await writeQueue;const sv=workspace.saves.find(s=>s.id===b.dataset.shareSave),pr=sv?.profiles.find(p=>p.id===b.dataset.shareProfile);const data=await request('/api/export-saves?save='+encodeURIComponent(b.dataset.shareSave)+'&profile='+encodeURIComponent(b.dataset.shareProfile)+'&share=1');downloadJson(data,(slug(pr?.name||'profile')||'profile')+'-share.json');toast('Share file downloaded: the plan without your progress. Others import it under Backup → Import saves.');}catch(err){toast(err.message,true);}finally{b.disabled=false;}}
 if(b.dataset.removeProfile){if(!allowSwitch())return;const sv=workspace.saves.find(s=>s.id===b.dataset.removeSave),pr=sv?.profiles.find(p=>p.id===b.dataset.removeProfile);if(!pr)return;if(!confirm('Are you sure? Remove "'+pr.name+'" and its progress and notes?'+(sv.profiles.length===1?' This also removes the empty save.':' Other profiles keep their progress.')))return;b.disabled=true;try{await writeQueue;await post('/api/remove-profile',{saveId:sv.id,profileId:pr.id,confirmed:true});await boot();if(workspace.saves.length)navigate('profiles');toast('Profile removed.');}catch(err){toast(err.message,true);b.disabled=false;}}
 if(b.dataset.openSave){if(!allowSwitch())return;b.disabled=true;try{await writeQueue;workspace=await post('/api/select',{saveId:b.dataset.openSave,profileId:b.dataset.openProfile});await loadContext(b.dataset.openSave,b.dataset.openProfile);navigate('plan');}catch(err){toast(err.message,true);b.disabled=false;}}
 if(b.dataset.wizardStep)await moveWizard(Number(b.dataset.wizardStep));
 if(b.hasAttribute('data-wizard-back'))await moveWizard(wizard.step-1);
 if(b.hasAttribute('data-cancel-wizard')){wizard=null;navigate('profiles');}
 if(b.dataset.authMode){authMode=b.dataset.authMode;renderSignedOut();}
 if(b.hasAttribute('data-logout')){if(!allowSwitch())return;await writeQueue;await post('/api/logout',{});authMode='login';await boot();}
});
document.addEventListener('submit',async e=>{
 const f=e.target;if(!['wizard-form','auth-form','rename-form'].includes(f.id))return;e.preventDefault();const b=f.querySelector('button[type="submit"]')||f.querySelector('button');b.disabled=true;
 try{
  if(f.id==='wizard-form'){
   const w=wizard;if(w.step<5){b.disabled=false;await moveWizard(w.step+1);return;}
   if(w.step===5){const r=await post('/api/profiles',{saveId:w.saveId,saveName:w.saveName,name:w.name,settings:w.settings},true,calcProgress(b,'Saving profile…'));workspace=r.workspace;await loadContext(r.saveId,r.profileId);wizard=null;navigate('plan');toast('Profile created. Your other progress is unchanged.');return;}

  }else if(f.id==='auth-form'){
   const data=Object.fromEntries(new FormData(f));data.registration=new FormData(f).has('registration');const mode=workspace.accountsEnabled?authMode:'setup';await post('/api/'+mode,data,false);await boot();
  }else{workspace=await post('/api/rename',Object.fromEntries(new FormData(f)));const s=workspace.saves.find(s=>s.id===currentSave.id);currentSave.name=s.name;currentProfile.name=s.profiles.find(p=>p.id===currentProfile.id).name;render();}
 }catch(err){if(f.id==='wizard-form')wizardError(f,err);else{const el=f.querySelector('.form-error');if(el)el.textContent=err.message;else toast(err.message,true);}b.disabled=false;if(f.id==='wizard-form')b.textContent=wizard.step===5?'Create profile':wizard.step===4?'Calculate plan':'Continue →';}
});
async function boot(){try{
 workspace=await request('/api/workspace');if(!workspace.user){authMode='login';renderSignedOut();return;}
 [plan,progressionData]=await Promise.all([request('/plan.json'),request('/progression.json')]);basePlan=plan;const save=workspace.saves.find(s=>s.id===workspace.activeSave)||workspace.saves[0];
 if(save){await loadContext(save.id,save.activeProfile);view=['plan','factories','storage','resources','backup','profiles','wizard','account'].includes(location.hash.slice(1))?location.hash.slice(1):'plan';if(view==='wizard'&&!wizard)view='profiles';render();}
 else{currentSave={id:'',name:'New save'};currentProfile={id:'',name:'Choose a profile'};state={settings:{phase:browserMode?'1':'3'},checks:{},notes:{},deliveries:{},customTasks:[]};calculated=null;startWizard();}
 }catch(e){$('#app').innerHTML=`<section class="loading"><h1>Could not open the planner</h1><p>${esc(e.message)}</p><button class="btn" id="retry">Try again</button></section>`;$('#retry').onclick=boot;}}
function browserNotice(){return `<div class="notice blue">Your saves stay in this browser on this device. Clearing site data or using private browsing can remove them. Export a full backup before switching devices or website addresses. <a href="#backup">Backups & transfer</a></div>`;}
function portablePanel(){return `<section class="panel"><h2>Full saves & transfer</h2><p>Export all your saves, profile calculations, checkmarks and notes. Account passwords and sessions are excluded. Import adds copies without replacing existing saves.</p><button class="btn primary" data-export-saves>Export all saves</button> <label class="btn">Import saves<input id="import-saves" type="file" accept="application/json,.json" hidden></label></section>`;}
function renderBrowserBackup(){return header('SAVED ON THIS DEVICE','Backups & transfer','No account or server is needed. Saves do not sync automatically between browsers.')+browserNotice()+portablePanel()+`<section class="panel"><h2>Keep a backup</h2><p>${workspace.lastBackup?'Last export: '+esc(new Date(workspace.lastBackup).toLocaleString()):'No full backup has been exported from this browser yet.'} Export after major changes and before clearing browser data.</p><button class="btn" data-persist-storage>Request persistent browser storage</button><p class="small">This reduces automatic eviction when supported. It cannot protect against manually clearing site data.</p><p>To move from Docker, update the Docker app and use Backup & notes → Export all saves, then import that file here. A legacy progress-only export is not a full save.</p><h2>Self-hosted edition</h2><p>The Docker edition keeps server storage and user accounts for access across devices. Browser storage remains local to each visitor.</p></section>`;}
function downloadJson(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.addEventListener('click',async e=>{
 const button=e.target.closest('button');if(!button)return;
 if(button.hasAttribute('data-export-saves')){button.disabled=true;try{await writeQueue;downloadJson(await request('/api/export-saves'),'satisfactory-full-saves.json');workspace=await request('/api/workspace');toast('Full save backup downloaded.');}catch(err){toast(err.message,true);}finally{button.disabled=false;}}
 if(button.hasAttribute('data-persist-storage')){try{const granted=await navigator.storage?.persist?.();toast(granted?'Persistent browser storage enabled.':'Browser did not grant persistence. Keep downloaded backups.');}catch(err){toast(err.message,true);}}
});
document.addEventListener('change',async e=>{
 if(e.target.id!=='import-saves'||!e.target.files[0])return;const file=e.target.files[0];
 try{if(file.size>50*1024*1024)throw Error('Choose a save export smaller than 50 MB.');const data=JSON.parse(await file.text());if(!confirm('Import these saves as new copies? Existing saves will be kept.'))return;await writeQueue;await post('/api/import-saves',data,false);await boot();navigate('profiles');toast('Imported saves. Existing progress was kept.');}catch(err){toast(err.message,true);}finally{e.target.value='';}
});
function renderCalculatedBackup(){if(browserMode)return renderBrowserBackup();return portablePanel()+header('THIS PROFILE','Backup & notes','Checkmarks, deliveries and notes belong to '+esc(currentSave.name)+' / '+esc(currentProfile.name))+`<div class="backup-grid"><section class="panel"><h2>Download progress</h2><a class="btn primary" href="/api/export?save=${currentSave.id}&profile=${currentProfile.id}" download>Download progress JSON</a><p class="small muted">For all accounts, profiles and calculation snapshots, back up the Docker data volume. This download contains only this profile’s progress.</p></section><section class="panel"><h2>Restore this profile</h2><p>Restore replaces only this profile’s progress, after confirmation.</p><label class="btn">Choose backup<input id="import-file" type="file" accept="application/json,.json" hidden></label></section></div><section class="panel"><h2>Save-wide notes for this profile</h2><textarea id="global-note" class="notes" maxlength="6000">${esc(state.notes.global||'')}</textarea><button class="btn" data-save-note="global" data-input="global-note">Save notes</button></section><section class="panel"><h2>Calculation assumptions</h2>${calculated.warnings.map(x=>`<p>${esc(x)}</p>`).join('')}<a href="https://github.com/greeny/SatisfactoryTools" target="_blank" rel="noreferrer">Recipe data source</a></section>`;}
boot();
