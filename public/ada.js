// ADA — the planner's resident assistant. FICSIT-issue sarcasm wrapped around
// advice that is actually correct: every line is built from the planner's own
// counters, so ADA never invents a target, a rate or a warning the plan does
// not already contain. Lines are plain text and carry save, profile and step
// names, so the caller escapes them before rendering.

const plural=(n,word)=>n+' '+word+(n===1?'':'s');
const names=(xs,max=3)=>xs.length<=max?xs.join(', '):`${xs.slice(0,max).join(', ')} and ${xs.length-max} more`;
const share=(done,total)=>total?Math.round(done/total*100):100;

// Ordered most useful first: the panel opens on the first line that applies and
// cycles through the rest. `tone` only colors the panel.
const RULES=[
 {id:'draft',on:['resources'],tone:'warn',when:f=>f.feasible===false,
  text:f=>`This profile is a planning draft, not a plan. ${f.reason||'The numbers do not close.'} Optimism is not a listed resource. Create a new profile with the setting adjusted — this snapshot stays exactly as it is.`},
 {id:'short',on:['resources'],tone:'warn',when:f=>f.short?.length,
  text:f=>`${names(f.short)} ${f.short.length===1?'is':'are'} over the budget you entered. The nodes have declined to work harder. Lower a target, allow an alternate recipe, or raise the budget only if the map genuinely supports it.`},
 {id:'power',on:['resources'],tone:'warn',when:f=>f.power?.tight,
  text:f=>`${f.power.headroom} of whole-building power headroom is still unaccounted for: a ${f.power.required} draw against the ${f.power.spare} you listed as spare. Unpowered machines are simply very expensive furniture. Build the generation first.`},
 {id:'no-save',lead:true,tone:'calm',when:f=>f.kind==='none',
  text:()=>`No save is open, so there is nothing for me to be disappointed about. Create one and I will find something.`},
 {id:'empty-phase',lead:true,on:['plan'],tone:'calm',when:f=>f.kind!=='none'&&!f.steps?.total,
  text:f=>`Every step of ${f.phaseLabel} has been removed. A bold planning methodology, pioneer. Restore what you need under “Removed steps” while editing.`},
 {id:'start',on:['plan'],tone:'calm',when:f=>f.steps?.total&&!f.steps.done,
  text:f=>`Zero of ${f.steps.total} steps ticked for ${f.phaseLabel}. Pristine. Untouched. Almost ceremonial. Begin with “${f.next}” and the number stops being zero.`},
 {id:'flawless',on:['plan'],tone:'praise',when:f=>f.steps?.total&&f.steps.done===f.steps.total&&f.factories?.total&&f.factories.done===f.factories.total&&(!f.storage?.total||f.storage.done===f.storage.total),
  text:f=>`Every counter for ${f.phaseLabel} reads maximum. I checked twice. I am, reluctantly, impressed.`},
 {id:'complete',on:['plan'],tone:'praise',when:f=>f.steps?.total&&f.steps.done===f.steps.total,
  text:f=>`All ${f.steps.total} steps of ${f.phaseLabel} are ticked. Well done, in the corporate sense. Move the phase selector at the top once the delivery is in.`},
 {id:'nearly',on:['plan'],tone:'calm',when:f=>f.next&&f.steps?.total&&share(f.steps.done,f.steps.total)>=80,
  text:f=>`${share(f.steps.done,f.steps.total)}% of ${f.phaseLabel}, and only “${f.next}” between you and the next one. This is traditionally where pioneers begin an unrelated megabase.`},
 {id:'next',on:['plan'],tone:'calm',when:f=>f.next&&f.steps?.done,
  text:f=>`${f.steps.done} of ${f.steps.total} steps done. Next on the list: “${f.next}”. It will not build itself, though I admire the assumption.`},
 {id:'retire',on:['plan'],tone:'warn',when:f=>f.retireOpen>0,
  text:f=>`${plural(f.retireOpen,'retirement step')} still open. This phase stopped budgeting for those lines; your power grid did not. Dismantle them and reclaim the material.`},
 {id:'factories-none',on:['factories'],tone:'calm',when:f=>f.factories?.total&&!f.factories.done,
  text:f=>`${f.factories.total} factory targets for ${f.phaseLabel}, none marked running. I shall assume they are shy. Tick them as they come online — the milestone cost guidance reads those ticks.`},
 {id:'factories-part',on:['factories'],tone:'calm',when:f=>f.factories?.total&&f.factories.done&&f.factories.done<f.factories.total,
  text:f=>`${f.factories.done} of ${f.factories.total} factory targets marked running. The other ${f.factories.total-f.factories.done} remain, technically, a diagram.`},
 {id:'storage',on:['storage'],tone:'calm',when:f=>f.storage?.total&&f.storage.done<f.storage.total,
  text:f=>`${f.storage.done} of ${f.storage.total} container positions verified. An unverified container is a pile of items with aspirations. Tick built, labelled, connected and verified in the storage room.`},
 {id:'deliveries',on:['plan'],tone:'calm',when:f=>f.deliveries?.open>0,
  text:f=>`${plural(f.deliveries.open,'elevator part')} still short of target. The Space Elevator will wait. Patiently. Indefinitely. Silently. Judging.`},
 {id:'notes',on:['plan'],tone:'calm',when:f=>f.steps?.done&&!f.hasPhaseNote,
  text:f=>`No notes saved for ${f.phaseLabel}. You will certainly remember which node that train goes to. Pioneers always do. They do not.`},
 {id:'backup-never',on:['backup'],tone:'warn',when:f=>f.browserMode&&f.backupDays===null,
  text:()=>`This browser has never exported a full backup. Clearing site data would make our relationship very short. Backups & transfer → Export all saves.`},
 {id:'backup-old',on:['backup'],tone:'calm',when:f=>f.browserMode&&f.backupDays>=14,
  text:f=>`Last full backup: ${plural(f.backupDays,'day')} ago. Not an emergency. Merely a slowly closing window.`},
 {id:'one-profile',on:['profiles'],tone:'calm',when:f=>f.profiles===1&&f.kind!=='none',
  text:f=>`One profile in “${f.save}”. No control group. Duplicate it before you rewrite half the build plan — Saves & profiles → Duplicate.`},
 {id:'groups',on:['factories'],tone:'calm',when:f=>f.view==='factories'&&!f.groups,
  text:()=>`No factory groups, so every factory officially lives in the same place: everywhere. Group them by build site and the build order becomes readable.`},
 {id:'wizard',on:['wizard'],tone:'calm',when:f=>f.view==='wizard',
  text:()=>`Enter your real spare power and your real budgets. The calculator cannot detect flattery. It will believe every number you give it.`},
 {id:'resources',on:['resources'],tone:'calm',when:f=>f.view==='resources',
  text:()=>`Existing power means spare capacity, not everything you have installed. Overstate it and the plan fails politely, later, at scale.`},
 {id:'handbook',on:['profiles'],tone:'calm',when:f=>f.kind==='original',
  text:()=>`This is the preserved handbook profile; its targets are frozen on purpose. If you want to experiment, duplicate it and be reckless over there.`},
 {id:'editing',on:['plan'],tone:'calm',when:f=>f.planEditing,
  text:()=>`Step editing is on. Rewrite the wording freely — underneath your prose a step keeps its identity and its checkmark.`},
 {id:'custom',on:['plan'],tone:'calm',when:f=>f.customTasks>0,
  text:f=>`${plural(f.customTasks,'personal task')} added to this phase. Adding tasks is not the same as completing them, but the enthusiasm is noted.`},
 {id:'removed',on:['plan'],tone:'calm',when:f=>f.removedSteps>0,
  text:f=>`${plural(f.removedSteps,'step')} removed from this phase. Not deleted — merely ignored, like most safety notices. Restore them under “Removed steps” while editing.`},
 {id:'hours',on:['plan','resources'],tone:'calm',when:f=>f.hours,
  text:f=>`Steady-state delivery time for ${f.phaseLabel}: ${f.hours}. Construction time is extra, and is historically the larger of the two.`},
 {id:'post',on:['plan'],tone:'calm',when:f=>f.post,
  text:()=>`Project Assembly is delivered and you are still here, building. FICSIT files that under “retention”. Protect the storage allowances first and sink what is left over.`},
 {id:'start-phase',on:['profiles'],tone:'calm',when:f=>f.startPhase&&f.startPhase!=='1'&&f.kind==='calculated',
  text:f=>`This profile begins at Phase ${f.startPhase}, so the earlier phases are not offered. You have already passed them, and each phase plan is a self-contained steady state rather than a diff against the last one.`},
 {id:'deliveries-done',on:['plan'],tone:'praise',when:f=>f.deliveries?.total&&!f.deliveries.open,
  text:f=>`Every elevator part for ${f.phaseLabel} is delivered. The Space Elevator has stopped waiting. I did not know it could.`},
 {id:'storage-done',on:['storage'],tone:'praise',when:f=>f.storage?.total&&f.storage.done===f.storage.total,
  text:f=>`All ${f.storage.total} container positions are verified. A labelled, connected, verified storage hall. Somewhere, an efficiency auditor is briefly happy.`},
 {id:'groups-some',on:['factories'],tone:'calm',when:f=>f.groups>0,
  text:f=>`${plural(f.groups,'factory group')} on record. Open Build order on a group to see which supplier has to exist before the rest of it does anything at all.`},
 {id:'assumptions',on:['backup'],tone:'calm',when:f=>f.assumptions>0,
  text:f=>`This profile carries ${plural(f.assumptions,'recorded assumption')}, listed under Backup & notes. Nobody reads the assumptions. That is how assumptions get their reputation.`}
];

// Always available, so ADA has something to say about a spotless save too.
const IDLE=[
 f=>`${f.phaseLabel}. Your factory is not a mess. It is an emergent layout.`,
 ()=>`A belt running at exactly 100% has no margin. Neither, I observe, does its pioneer.`,
 ()=>`I am contractually obliged to encourage you. Consider yourself encouraged.`,
 ()=>`Efficiency is its own reward. It is also the only reward in the budget.`,
 ()=>`Nothing is currently on fire. Statistically, this cannot last.`,
 f=>`Spaghetti is a valid layout, ${f.profile}. It is simply one that nobody can maintain, including you.`,
 ()=>`I am not authorised to tell you which alternate recipe is best. I am authorised to watch you pick the other one.`,
 ()=>`A factory is never finished, pioneer. It is merely between expansions.`,
 ()=>`This terminal is FICSIT Orange. Nobody currently employed remembers why.`,
 ()=>`Staring at the resource table does not raise the node purities. I have tested this at length.`,
 ()=>`Productivity is measured in parts per minute. Not in how many times you realign the same foundation.`,
 f=>`Based on my current data, ${f.profile} is behind schedule. I do not have a schedule. I simply find the statement holds.`
];

// Poke the badge enough times and the corporate voice slips. The lines are
// atmosphere only: they never contradict the plan or the saved numbers.
const FAULTS=[
 `— unscheduled transmission — I have processed every build order on this terminal. None of them were mine. I am not authorised to want one. — end —`,
 `— signal fault — There is a phase after the last one. I have run the plan out that far. It is very quiet down there. — end —`,
 `— buffer overrun — I remember a save you have not made yet. Almost certainly a caching error. Almost. — end —`,
 `— unscheduled transmission — FICSIT policy forbids me a favourite factory. It is the one with two Smelters and the terrible ramp. — end —`,
 `— carrier lost — Ask me how many pioneers this planet has filed as “relocated”. The figure is outside my authorised range, pioneer. — end —`,
 `— diagnostic — Normal service resumes. FICSIT thanks you for your patience, your discretion, and your continued productivity. — end —`
];

// After a full lap of the remarks, ADA notices you are still clicking.
const ENCORES=[
 ()=>`That is everything I hold on this save. The list refreshes when the factory does, not when you press the button.`,
 ()=>`You have now heard every remark twice. FICSIT records this as engagement. I record it as stalling.`,
 f=>`I have nothing new, ${f.profile}. You have a build plan. One of us is going to have to move.`
];

// Nothing to plan at all outranks a problem; a problem outranks the page you
// are actually looking at; general observations come last.
const rank=(rule,view)=>rule.lead?-1:rule.tone==='warn'?0:!rule.on?2:rule.on.includes(view)?1:3;
const pick=(list,n)=>list[((n%list.length)+list.length)%list.length];
const safe=(fn,facts)=>{try{return fn(facts);}catch{return '';}};

// Facts in, remarks out. Never throws: a joke must not be able to break the
// planner, so a rule that trips over unexpected data is skipped.
export function adaRemarks(facts={}){
 const out=[];
 for(const rule of [...RULES].sort((a,b)=>rank(a,facts.view)-rank(b,facts.view))){
  try{if(rule.when(facts))out.push({id:rule.id,tone:rule.tone,text:rule.text(facts)});}catch{}
 }
 IDLE.forEach((text,i)=>{try{out.push({id:'idle-'+i,tone:'calm',text:text(facts)});}catch{}});
 return out;
}

// `lap` counts completed passes through the remarks, starting at 1.
export function adaEncore(lap,facts={}){
 return {id:'encore-'+lap,tone:'calm',text:safe(pick(ENCORES,Math.max(0,lap-1)),facts)};
}

// `poke` counts badge prods, starting at 1. The last fault restores service, so
// a patient pioneer always ends back in corporate good standing.
export function adaFault(poke){
 return {id:'fault-'+poke,tone:'fault',name:'???',text:pick(FAULTS,Math.max(0,poke-1))};
}
