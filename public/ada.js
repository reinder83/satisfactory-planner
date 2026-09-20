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
  text:f=>`Steady-state delivery time for ${f.phaseLabel}: ${f.hours}. Construction time is extra, and is historically the larger of the two.`}
];

// Always available, so ADA has something to say about a spotless save too.
const IDLE=[
 f=>`${f.phaseLabel}. Your factory is not a mess. It is an emergent layout.`,
 ()=>`A belt running at exactly 100% has no margin. Neither, I observe, does its pioneer.`,
 ()=>`I am contractually obliged to encourage you. Consider yourself encouraged.`,
 ()=>`Efficiency is its own reward. It is also the only reward in the budget.`,
 ()=>`Nothing is currently on fire. Statistically, this cannot last.`,
 f=>`Spaghetti is a valid layout, ${f.profile}. It is simply one that nobody can maintain, including you.`
];

// A problem outranks everything; after that ADA talks about the page you are
// actually looking at, and keeps its general observations for last.
const rank=(rule,view)=>rule.tone==='warn'?0:!rule.on?2:rule.on.includes(view)?1:3;

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
