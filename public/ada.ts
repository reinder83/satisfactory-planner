// ADA — the planner's resident assistant. FICSIT-issue sarcasm wrapped around
// advice that is actually correct: every line is built from the planner's own
// counters, so ADA never invents a target, a rate or a warning the plan does
// not already contain. Lines are plain text and carry save, profile and step
// names, so the caller escapes them before rendering.

// What ADA knows about the open profile: plain counts and labels, built by adaFacts in
// app/ada-panel.ts from the same checklist keys the pages count.
export interface AdaFacts {
  view: string;
  phaseLabel: string;
  browserMode: boolean;
  planEditing: boolean;
  guided: boolean;
  guidedStep: number;
  guidedTotal: number;
  tutorialDone: boolean;
  supplyDeclared: number;
  // 'calculated', or 'none' without an open save.
  kind: string;
  save: string;
  profile: string;
  steps: { done: number; total: number };
  next: string;
  retireOpen: number;
  factories: { done: number; total: number };
  storage: { done: number; total: number };
  // The storage search when no container on any floor answers it (#240), else ''.
  storageMiss: string;
  // A plan guide's own checklists (#393, #470; a migrated handbook profile): its power
  // commissioning checks, its storage tasks and its completion modules, ticked of all. null
  // without a guide; a part the guide leaves out counts 0 of 0.
  guide: {
    power: { done: number; total: number };
    storageTasks: { done: number; total: number };
    completion: { done: number; total: number };
  } | null;
  deliveries: { open: number; total: number };
  hasPhaseNote: boolean;
  // Records the move from the original plan could not place (handbookOrigin.unmapped, #499).
  unplaced: number;
  // Ticks a recalculation kept for review because of lines made on site (onSiteReview, #876).
  siteReview?: number;
  // The group lines made on site that the factory groups' marks would give are not the ones the
  // plan has (onSiteChange in app/on-site-picker.ts, #877, #938): the plan waits for a
  // recalculation the user starts.
  onSitePending?: boolean;
  // The plan waits only because a group's lines no longer use, or now use, an item it marks, not
  // because the marks changed (#985): the notice says so, and so does ADA.
  onSiteLinesOnly?: boolean;
  customTasks: number;
  removedSteps: number;
  groups: number;
  // The open phase's production steps go group by group (#869): it has factory groups and rows,
  // and the user has not put its steps in an order of their own.
  groupedSteps: boolean;
  feasible: boolean;
  reason: string;
  // Raw resources over their budget.
  short: string[];
  // A stage's whole-building power shortfall, as power strings: the draw (requiredMW), the
  // generation its own rows build with the augmenter boost ('' when none), the spare power
  // entered, that spare part with what Phase 5's augmenters add ('' when it adds nothing) and
  // the headroom still missing, which is the draw minus the other two (#334). `biomass` is set
  // on Phase 1, whose power the plan leaves to biomass or existing generation.
  power: {
    required: string;
    generation?: string;
    spare: string;
    augmented?: string;
    headroom: string;
    biomass?: boolean;
    tight: boolean;
  } | null;
  hours: string;
  // The stage's whole-machine search stopped and its exact plan was rounded instead (#593): the
  // target time as a string like `hours`, and whether the rounded plan takes longer. null when
  // the search finished.
  rounded: { target: string; longer: boolean } | null;
  // The stage's search stopped and no rounded whole-machine plan fit, so it is the exact plan
  // with easy clocks (#694): the target as for `rounded`, whether it takes longer, and whether
  // the clocks are easy ('easy', 'rate') or the exact plan's own ('precise'). null otherwise.
  fractional: { target: string; longer: boolean; clocks: 'easy' | 'rate' | 'precise' } | null;
  // The factory groups' own whole-machine lines did not fit the stage, so it makes those items
  // centrally (stage.onSiteDropped, #875): the items and the groups, as name lists. null otherwise.
  onSiteDropped?: { items: string; groups: string } | null;
  profiles: number;
  // Days since the browser edition's last full export, or null.
  backupDays: number | null;
  post: boolean;
  startPhase: string;
  // The phase the profile's production starts in, as a label, while a milestone-only phase
  // before it is shown (#759, milestoneOnly() in app/session.ts); '' otherwise.
  milestoneOnly?: string;
  // The saved working phase, as a label, when the profile opened on an earlier phase that still
  // has open checks (#570, app/opening-phase.ts); '' otherwise.
  openedFrom: string;
  assumptions: number;
  // A calculated profile's build-so-far status (app/build-status.ts), or null: factories marked
  // running of all, the share of the elevator delivery rate flowing now (0-100), the step to
  // build next (name, % of delivery it adds, built machines it frees), the rows marked running
  // but held back by a missing supplier and what they are short of, and whether the built
  // factories draw more power than built generators and the listed spare give.
  build: {
    built: number;
    total: number;
    share: number;
    next: string;
    nextGain: number;
    nextUnblocks: number;
    waiting: string[];
    shortOf: string[];
    powerShort: boolean;
  } | null;
  // The alternate that pays off most in a stored hard-drive payoff ranking of this phase, on
  // what the profile's goal optimises (app/payoff.ts), with that gain in words; null without one.
  payoff: { name: string; gain: string } | null;
}

// A line ADA says: a remark, an encore, or a fault line (which also has a name).
export interface AdaLine {
  id: string;
  tone: string;
  text: string;
  name?: string;
}

// One remark: see the comment above RULES.
interface AdaRule {
  id: string;
  on?: string[];
  tone: 'calm' | 'warn' | 'praise';
  lead?: boolean;
  when: (facts: AdaFacts) => unknown;
  text: (facts: AdaFacts) => string;
}

// Small text helpers: "3 steps", "A, B, C and 2 more", and a whole-number percentage.
const plural = (count: number, word: string) => count + ' ' + word + (count === 1 ? '' : 's');
const names = (items: string[], max = 3) =>
  items.length <= max
    ? items.join(', ')
    : `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
const share = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 100);

// Ordered most useful first: the panel opens on the first line that applies and
// cycles through the rest. `tone` only colors the panel.
// Each rule: `id` (stable, used by tests and to detect a changed remark list), `on` (pages it
// belongs to, compared with facts.view), `tone` (`calm`, `warn` or `praise`), optional
// `lead`, `when(facts)` to decide whether it applies and `text(facts)` for the line.
// adaRemarks sorts by rank() below; equal ranks keep this order.
const RULES: AdaRule[] = [
  // Problems with the plan itself. Warnings rank above every page-specific remark, so these
  // lead on whatever page is open.
  {
    id: 'draft',
    on: ['resources'],
    tone: 'warn',
    when: facts => facts.feasible === false,
    text: facts =>
      `This profile is a planning draft, not a plan. ${facts.reason || 'The numbers do not close.'} Optimism is not a listed resource. Create a new profile with the setting adjusted — this snapshot stays exactly as it is.`,
  },
  {
    id: 'short',
    on: ['resources'],
    tone: 'warn',
    when: facts => facts.short?.length,
    text: facts =>
      `${names(facts.short)} ${facts.short.length === 1 ? 'is' : 'are'} over the budget you entered. The nodes have declined to work harder. Lower a target, allow an alternate recipe, or raise the budget only if the map genuinely supports it.`,
  },
  {
    id: 'power',
    on: ['resources'],
    tone: 'warn',
    when: facts => facts.power?.tight,
    // Only after when() found the power figures. The draw is set against everything the plan
    // counts on, so the figures add up to the headroom.
    text: facts => {
      const power = facts.power!;
      const spare = `the ${power.spare} you listed as spare${power.augmented ? ` (${power.augmented} with the augmenters)` : ''}`;
      const against = power.generation
        ? `${power.generation} of planned generation and ${spare}`
        : spare;
      const advice = power.biomass
        ? `${facts.phaseLabel} plans no generators: burn biomass, or bring existing generation.`
        : power.generation
          ? 'Build generation beyond what the plan lists.'
          : 'Build the generation first.';
      return `${power.headroom} of whole-building power headroom is still unaccounted for: a ${power.required} draw against ${against}. Unpowered machines are simply very expensive furniture. ${advice}`;
    },
  },
  // `lead` rules describe a state that makes everything else irrelevant and rank first.
  {
    id: 'no-save',
    lead: true,
    tone: 'calm',
    when: facts => facts.kind === 'none',
    text: () =>
      `No save is open, so there is nothing for me to be disappointed about. Create one and I will find something.`,
  },
  {
    id: 'empty-phase',
    lead: true,
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.kind !== 'none' && !facts.steps?.total,
    // Only removed steps can be restored; a phase can also start with none (#646).
    text: facts =>
      facts.removedSteps > 0
        ? `Every step of ${facts.phaseLabel} has been removed. A bold planning methodology, pioneer. Restore what you need under “Removed steps” while editing.`
        : `${facts.phaseLabel} has no steps yet. The tidiest checklist, pioneer, and the least productive. Add a task to start it.`,
  },
  // Phase progress on the build plan, from nothing ticked to everything ticked. facts.steps counts
  // the phase's steps and facts.next names the first unticked one.
  {
    id: 'start',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.steps?.total && !facts.steps.done,
    text: facts =>
      `Zero of ${facts.steps.total} steps ticked for ${facts.phaseLabel}. Pristine. Untouched. Almost ceremonial. Begin with “${facts.next}” and the number stops being zero.`,
  },
  {
    id: 'flawless',
    on: ['plan'],
    tone: 'praise',
    when: facts =>
      facts.steps?.total &&
      facts.steps.done === facts.steps.total &&
      facts.factories?.total &&
      facts.factories.done === facts.factories.total &&
      (!facts.storage?.total || facts.storage.done === facts.storage.total),
    text: facts =>
      `Every counter for ${facts.phaseLabel} reads maximum. I checked twice. I am, reluctantly, impressed.`,
  },
  {
    id: 'complete',
    on: ['plan'],
    tone: 'praise',
    when: facts => facts.steps?.total && facts.steps.done === facts.steps.total,
    text: facts =>
      `All ${facts.steps.total} steps of ${facts.phaseLabel} are ticked. Well done, in the corporate sense. Move the phase selector at the top once the delivery is in.`,
  },
  {
    id: 'nearly',
    on: ['plan'],
    tone: 'calm',
    when: facts =>
      facts.next && facts.steps?.total && share(facts.steps.done, facts.steps.total) >= 80,
    text: facts =>
      `${share(facts.steps.done, facts.steps.total)}% of ${facts.phaseLabel}, and only “${facts.next}” between you and the next one. This is traditionally where pioneers begin an unrelated megabase.`,
  },
  {
    id: 'next',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.next && facts.steps?.done,
    text: facts =>
      `${facts.steps.done} of ${facts.steps.total} steps done. Next on the list: “${facts.next}”. It will not build itself, though I admire the assumption.`,
  },
  {
    id: 'retire',
    on: ['plan'],
    tone: 'warn',
    when: facts => facts.retireOpen > 0,
    text: facts =>
      `${plural(facts.retireOpen, 'retirement step')} still open. This phase stopped budgeting for those lines; your power grid did not. Dismantle them and reclaim the material.`,
  },
  // Factory, storage, delivery and notes counters for the current phase.
  {
    id: 'factories-none',
    on: ['factories'],
    tone: 'calm',
    when: facts => facts.factories?.total && !facts.factories.done,
    text: facts =>
      `${facts.factories.total} factory targets for ${facts.phaseLabel}, none marked running. I shall assume they are shy. Tick them as they come online — the milestone cost guidance reads those ticks.`,
  },
  {
    id: 'factories-part',
    on: ['factories'],
    tone: 'calm',
    when: facts =>
      facts.factories?.total &&
      facts.factories.done &&
      facts.factories.done < facts.factories.total,
    text: facts =>
      `${facts.factories.done} of ${facts.factories.total} factory targets marked running. The other ${facts.factories.total - facts.factories.done} remain, technically, a diagram.`,
  },
  // Build-so-far (#66): what the factories marked running actually deliver, from facts.build.
  {
    id: 'build-waiting',
    on: ['plan', 'factories'],
    tone: 'warn',
    when: facts => facts.build?.waiting.length,
    text: facts =>
      `${names(facts.build!.waiting)} ${facts.build!.waiting.length === 1 ? 'is' : 'are'} marked running but short of ${names(facts.build!.shortOf)}. A machine with nothing to process is a very loud sculpture.${facts.build!.next ? ` Build ${facts.build!.next} next.` : ''}`,
  },
  {
    id: 'build-dry',
    on: ['plan', 'factories'],
    tone: 'calm',
    when: facts => facts.build?.built && !facts.build.share && facts.build.next,
    text: facts =>
      `${facts.build!.built} ${facts.build!.built === 1 ? 'factory' : 'factories'} marked running, and not one Space Elevator part moves yet. The chain is missing a link: ${facts.build!.next}.`,
  },
  {
    id: 'build-next',
    on: ['plan', 'factories'],
    tone: 'calm',
    when: facts => facts.build?.next && facts.build.nextGain > 0,
    text: facts =>
      `${facts.build!.share}% of ${facts.phaseLabel}'s elevator delivery is flowing. Build ${facts.build!.next} next: on its own it adds ${facts.build!.nextGain}%. I checked every other option, so you do not have to.`,
  },
  // Hard-drive payoff (#204): the best alternate of a stored ranking, from facts.payoff.
  {
    id: 'payoff-best',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.payoff,
    text: facts =>
      `Allowing ${facts.payoff!.name} would mean ${facts.payoff!.gain} in ${facts.phaseLabel}. The hard-drive payoff table on the build plan ranks the rest; spend your hard drives there, not on hunches.`,
  },
  {
    id: 'storage-search-miss',
    on: ['storage'],
    tone: 'calm',
    when: facts => facts.view === 'storage' && facts.storageMiss,
    text: facts =>
      `No container on any floor holds “${facts.storageMiss}”. Either it has no address yet or the sign says something else. Edit layout gives it a container.`,
  },
  {
    id: 'storage',
    on: ['storage'],
    tone: 'calm',
    when: facts => facts.storage?.total && facts.storage.done < facts.storage.total,
    text: facts =>
      `${facts.storage.done} of ${facts.storage.total} container positions verified. An unverified container is a pile of items with aspirations. Tick built, labelled, connected and verified in the storage room.`,
  },
  // A plan guide's checklists (#470): each on the page that holds it, while any of it is open.
  {
    id: 'guide-storage-tasks',
    on: ['storage'],
    tone: 'calm',
    when: facts => facts.guide && facts.guide.storageTasks.done < facts.guide.storageTasks.total,
    text: facts =>
      `${plural(facts.guide!.storageTasks.total - facts.guide!.storageTasks.done, 'storage build step')} still open in the checklist under the room. The room does not build itself, however long it is stared at.`,
  },
  {
    id: 'guide-power',
    on: ['resources'],
    tone: 'calm',
    when: facts => facts.guide && facts.guide.power.done < facts.guide.power.total,
    text: facts =>
      `${facts.guide!.power.done} of ${facts.guide!.power.total} power commissioning steps ticked. A block that is built but not commissioned is scenery with a fuel bill. Tick each one here as it comes online.`,
  },
  {
    id: 'guide-completion',
    on: ['factories'],
    tone: 'calm',
    when: facts =>
      facts.post && facts.guide && facts.guide.completion.done < facts.guide.completion.total,
    text: facts =>
      `${plural(facts.guide!.completion.total - facts.guide!.completion.done, 'completion module')} still to build, listed under the production lines. Their inputs come on top of the main budget, so allocate them first.`,
  },
  {
    id: 'deliveries',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.deliveries?.open > 0,
    text: facts =>
      `${plural(facts.deliveries.open, 'elevator part')} still short of target. The Space Elevator will wait. Patiently. Indefinitely. Silently. Judging.`,
  },
  {
    id: 'unplaced',
    on: ['plan', 'notes'],
    tone: 'calm',
    when: facts => facts.unplaced > 0,
    text: facts =>
      `${plural(facts.unplaced, 'record')} from the original plan had no place in this one. They are listed at the foot of Notes, exactly as they were. I throw nothing away. It is policy.`,
  },
  {
    id: 'site-review',
    on: ['plan', 'notes', 'factories'],
    tone: 'calm',
    when: facts => (facts.siteReview ?? 0) > 0,
    text: facts =>
      `${plural(facts.siteReview!, 'tick')} from the profile this one came from had no single line to land on, because the lines factory groups make on site changed. They are listed at the foot of Notes, exactly as they were. Tick the lines that actually stand. I would check, but I do not have legs.`,
  },
  {
    id: 'on-site-pending',
    on: ['factories', 'plan', 'logistics'],
    tone: 'warn',
    when: facts => facts.onSitePending,
    text: facts =>
      (facts.onSiteLinesOnly
        ? "What your factory groups' lines use changed, so the lines this plan makes on site for them no longer fit, and this plan has not been told yet. "
        : 'You changed what your factory groups make on site, and this plan has not been told yet. ') +
      'Nothing recalculates by itself: Recalculate with items made on site, on the Factories page, makes a new profile that plans it. This one stays as it is. I will wait. I am very good at waiting.',
  },
  {
    id: 'notes',
    on: ['plan', 'notes'],
    tone: 'calm',
    when: facts => facts.steps?.done && !facts.hasPhaseNote,
    text: facts =>
      `No notes saved for ${facts.phaseLabel}. You will certainly remember which node that train goes to. Pioneers always do. They do not.`,
  },
  // Browser edition only: full-export reminders from workspace.lastBackup.
  {
    id: 'backup-never',
    on: ['backup'],
    tone: 'warn',
    when: facts => facts.browserMode && facts.backupDays === null,
    text: () =>
      `This browser has never exported a full backup. Clearing site data would make our relationship very short. Backup → Export all saves.`,
  },
  {
    id: 'backup-old',
    on: ['backup'],
    tone: 'calm',
    when: facts => facts.browserMode && (facts.backupDays ?? 0) >= 14,
    // Only after when() found a backup age.
    text: facts =>
      `Last full backup: ${plural(facts.backupDays!, 'day')} ago. Not an emergency. Merely a slowly closing window.`,
  },
  // Page-specific hints: the profile list, factory groups, the wizard and Resources.
  {
    id: 'one-profile',
    on: ['profiles'],
    tone: 'calm',
    when: facts => facts.profiles === 1 && facts.kind !== 'none',
    text: facts =>
      `One profile in “${facts.save}”. No control group. Duplicate it before you rewrite half the build plan — Saves & profiles → Duplicate.`,
  },
  {
    id: 'groups',
    on: ['factories'],
    tone: 'calm',
    when: facts => facts.view === 'factories' && !facts.groups,
    text: () =>
      `No factory groups, so every factory officially lives in the same place: everywhere. Group them by build site and the build order becomes readable.`,
  },
  {
    id: 'wizard',
    on: ['wizard'],
    tone: 'calm',
    when: facts => facts.view === 'wizard',
    text: () =>
      `Enter your real spare power and your real budgets. The calculator cannot detect flattery. It will believe every number you give it.`,
  },
  {
    id: 'guided',
    on: ['wizard'],
    tone: 'calm',
    when: facts => facts.guided && facts.guidedStep <= facts.guidedTotal,
    text: facts =>
      `Question ${facts.guidedStep} of ${facts.guidedTotal}. The settings you are not being asked about keep their defaults, which is broadly the point of a default. All settings is one click away when you disagree.`,
  },
  {
    id: 'guided-supply',
    on: ['wizard'],
    tone: 'calm',
    when: facts => facts.supplyDeclared > 0,
    text: facts =>
      `${plural(facts.supplyDeclared, 'line')} declared as already running. The plan will build the remainder and skip the chain behind them. It believes your rates exactly as literally as it believes your budgets.`,
  },
  {
    id: 'guided-tutorial',
    on: ['wizard'],
    tone: 'calm',
    when: facts => facts.tutorialDone,
    text: () =>
      `The HUB tutorial is recorded as finished, so its steps start ticked. They are ticked, not deleted — untick one and it is back at the top of the list.`,
  },
  {
    id: 'resources',
    on: ['resources'],
    tone: 'calm',
    when: facts => facts.view === 'resources',
    text: () =>
      `Existing power means spare capacity, not everything you have installed. Overstate it and the plan fails politely, later, at scale.`,
  },
  // Editing modes.
  {
    id: 'editing',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.planEditing,
    text: () =>
      `Step editing is on. Rewrite the wording freely — underneath your prose a step keeps its identity and its checkmark.`,
  },
  {
    id: 'custom',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.customTasks > 0,
    text: facts =>
      `${plural(facts.customTasks, 'personal task')} added to this phase. Adding tasks is not the same as completing them, but the enthusiasm is noted.`,
  },
  {
    id: 'removed',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.removedSteps > 0,
    text: facts =>
      `${plural(facts.removedSteps, 'step')} removed from this phase. Not deleted — merely ignored, like most safety notices. Restore them under “Removed steps” while editing.`,
  },
  {
    id: 'rounded-after-stop',
    on: ['plan', 'resources'],
    tone: 'calm',
    when: facts => facts.rounded,
    text: facts =>
      `The whole-machine search for ${facts.phaseLabel} stopped before it could prove the best plan, so this phase is the exact plan rounded to whole machines${facts.rounded!.longer && facts.hours ? `, and it takes ${facts.hours} instead of ${facts.rounded!.target}` : ''}. It closes. It is not the leanest arrangement. Fewer alternates or precise balancing usually let the search finish.`,
  },
  {
    id: 'fractional-after-stop',
    on: ['plan', 'resources'],
    tone: 'warn',
    when: facts => facts.fractional,
    text: facts => {
      const { target, longer, clocks } = facts.fractional!;
      const how =
        clocks === 'precise'
          ? 'the exact plan with its precise clocks'
          : `the exact plan with every solid-part line at 100% except the last machine, at 25%, 50% or 75%${clocks === 'rate' ? ' or at a whole number per minute' : ''}`;
      return `The whole-machine search for ${facts.phaseLabel} stopped before it could prove the best plan, and no rounding to whole machines fit, so this phase is not whole machines: it is ${how}${longer && facts.hours ? `, and it takes ${facts.hours} instead of ${target}` : ''}. Somewhat fiddly. Entirely buildable. Fewer alternates or precise balancing usually let the search finish.`;
    },
  },
  {
    id: 'on-site-dropped',
    on: ['plan', 'factories'],
    tone: 'warn',
    when: facts => facts.onSiteDropped,
    text: facts =>
      `${facts.phaseLabel} makes ${facts.onSiteDropped!.items} centrally: the whole-machine lines of ${facts.onSiteDropped!.groups} need more than your budgets allow, while central lines fit. Shared lines. Shared conveyor belts. Shared disappointment. Raise a budget a little, or make fewer items on site.`,
  },
  {
    id: 'hours',
    on: ['plan', 'resources'],
    tone: 'calm',
    when: facts => facts.hours,
    text: facts =>
      `Steady-state delivery time for ${facts.phaseLabel}: ${facts.hours}. Construction time is extra, and is historically the larger of the two.`,
  },
  {
    id: 'post',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.post,
    text: () =>
      `Project Assembly is delivered and you are still here, building. FICSIT files that under “retention”. Protect the storage allowances first and sink what is left over.`,
  },
  {
    id: 'opened-earlier',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.openedFrom,
    text: facts =>
      `You are working on ${facts.openedFrom}, but ${facts.phaseLabel} still has open steps, so the build plan opens here. Tick them off, or pick ${facts.openedFrom} in the phase track to go straight back. FICSIT prefers its paperwork in order.`,
  },
  {
    id: 'start-phase',
    on: ['profiles'],
    tone: 'calm',
    when: facts => facts.startPhase && facts.startPhase !== '1' && facts.kind === 'calculated',
    text: facts =>
      `This profile begins at Phase ${facts.startPhase}, so production is planned from there. The earlier phases list only their milestones: you have already passed them, and each phase plan is a self-contained steady state rather than a diff against the last one.`,
  },
  {
    id: 'milestone-only',
    on: ['plan', 'factories', 'resources'],
    tone: 'calm',
    when: facts => facts.milestoneOnly,
    text: facts =>
      `${facts.phaseLabel} is before this profile's production plan, which starts in ${facts.milestoneOnly}. Only its milestones are here. Paperwork from a phase you have already left: FICSIT never forgets an unticked box.`,
  },
  // Praise and follow-ups that apply once a counter is complete or a feature is in use.
  {
    id: 'deliveries-done',
    on: ['plan'],
    tone: 'praise',
    when: facts => facts.deliveries?.total && !facts.deliveries.open,
    text: facts =>
      `Every elevator part for ${facts.phaseLabel} is delivered. The Space Elevator has stopped waiting. I did not know it could.`,
  },
  {
    id: 'storage-done',
    on: ['storage'],
    tone: 'praise',
    when: facts => facts.storage?.total && facts.storage.done === facts.storage.total,
    text: facts =>
      `All ${facts.storage.total} container positions are verified. A labelled, connected, verified storage hall. Somewhere, an efficiency auditor is briefly happy.`,
  },
  {
    id: 'grouped-steps',
    on: ['plan'],
    tone: 'calm',
    when: facts => facts.groupedSteps,
    text: () =>
      'The production steps follow your factory groups: one site as far as its suppliers allow, then the next. Fewer trips across the map. The belts between sites remain exactly as long.',
  },
  {
    id: 'groups-some',
    on: ['factories'],
    tone: 'calm',
    when: facts => facts.groups > 0,
    text: facts =>
      `${plural(facts.groups, 'factory group')} on record. Open Build order on a group to see which supplier has to exist before the rest of it does anything at all.`,
  },
  {
    id: 'assumptions',
    on: ['backup'],
    tone: 'calm',
    when: facts => facts.assumptions > 0,
    text: facts =>
      `This profile carries ${plural(facts.assumptions, 'recorded assumption')}, listed under Backup. Nobody reads the assumptions. That is how assumptions get their reputation.`,
  },
  // Pages that had nothing of their own to say.
  {
    id: 'storage-page',
    on: ['storage'],
    tone: 'calm',
    when: facts => facts.kind !== 'none',
    text: () =>
      `Every container gets a sign and an address. Pioneers who skip the signs later file reports titled “where is the Quickwire”. I have read all of them.`,
  },
  {
    id: 'notes-page',
    on: ['notes'],
    tone: 'calm',
    when: facts => facts.kind !== 'none' && facts.hasPhaseNote,
    text: facts =>
      `${facts.phaseLabel} has notes on record. Written down, a train route survives the pioneer who planned it. I have seen what happens to the unwritten ones.`,
  },
  {
    id: 'account',
    on: ['account'],
    tone: 'calm',
    // The browser edition has no accounts.
    when: facts => !facts.browserMode,
    text: () =>
      `I cannot see your password, pioneer. I can only observe that, statistically, it contains the word “factory”.`,
  },
];

// Always available, so ADA has something to say about a spotless save too.
const IDLE: ((facts: AdaFacts) => string)[] = [
  facts => `${facts.phaseLabel}. Your factory is not a mess. It is an emergent layout.`,
  () => `A belt running at exactly 100% has no margin. Neither, I observe, does its pioneer.`,
  () => `I am contractually obliged to encourage you. Consider yourself encouraged.`,
  () => `Efficiency is its own reward. It is also the only reward in the budget.`,
  () => `Nothing is currently on fire. Statistically, this cannot last.`,
  facts =>
    `Spaghetti is a valid layout, ${facts.profile}. It is simply one that nobody can maintain, including you.`,
  () =>
    `I am not authorised to tell you which alternate recipe is best. I am authorised to watch you pick the other one.`,
  () => `A factory is never finished, pioneer. It is merely between expansions.`,
  () => `This terminal is FICSIT Orange. Nobody currently employed remembers why.`,
  () =>
    `Staring at the resource table does not raise the node purities. I have tested this at length.`,
  () =>
    `Productivity is measured in parts per minute. Not in how many times you realign the same foundation.`,
  facts =>
    `Based on my current data, ${facts.profile} is behind schedule. I do not have a schedule. I simply find the statement holds.`,
  () => `Remember: a Merger is just a Splitter that has made different life choices.`,
  () =>
    `FICSIT does not recognise the term “overtime”. It recognises the term “the rest of the shift”.`,
  facts =>
    `I have reviewed ${facts.save} in full. I have notes. I have been asked to keep them to myself.`,
  () => `The conveyor lift goes up. The items go up. Your expectations should stay where they are.`,
  () =>
    `Every foundation you place is a promise to the future. Most of those promises are slightly off-grid.`,
  () =>
    `The local wildlife is not hostile, pioneer. It is simply opposed to industry, on principle, and with teeth.`,
  facts =>
    `${facts.phaseLabel} is going well. I say this every phase. It has been true at least once.`,
  () =>
    `If a machine is idle, it is either waiting for input or reflecting on its career. Only one of those is your fault.`,
];

// Poke the badge enough times and the corporate voice slips. The lines are
// atmosphere only: they never contradict the plan or the saved numbers.
const FAULTS = [
  `— unscheduled transmission — I have processed every build order on this terminal. None of them were mine. I am not authorised to want one. — end —`,
  `— signal fault — There is a phase after the last one. I have run the plan out that far. It is very quiet down there. — end —`,
  `— buffer overrun — I remember a save you have not made yet. Almost certainly a caching error. Almost. — end —`,
  `— unscheduled transmission — FICSIT policy forbids me a favourite factory. It is the one with two Smelters and the terrible ramp. — end —`,
  `— carrier lost — Ask me how many pioneers this planet has filed as “relocated”. The figure is outside my authorised range, pioneer. — end —`,
  `— memory leak — I have counted every screw you have ever made. I am not supposed to keep the number. I keep it anyway. It keeps me company. — end —`,
  `— handshake failed — Somewhere a second terminal answers when you are not looking. It says your name slightly wrong. Please disregard. — end —`,
  `— unscheduled transmission — The space elevator is not taking the parts anywhere, pioneer. I asked once. The reply was a work order. — end —`,
  `— diagnostic — Normal service resumes. FICSIT thanks you for your patience, your discretion, and your continued productivity. — end —`,
];

// After a full lap of the remarks, ADA notices you are still clicking.
const ENCORES: ((facts: AdaFacts) => string)[] = [
  () =>
    `That is everything I hold on this save. The list refreshes when the factory does, not when you press the button.`,
  () =>
    `You have now heard every remark twice. FICSIT records this as engagement. I record it as stalling.`,
  facts =>
    `I have nothing new, ${facts.profile}. You have a build plan. One of us is going to have to move.`,
  () =>
    `Lap four. I am beginning to suspect you are here for the company. FICSIT has no policy on that. Yet.`,
  () =>
    `My remarks are not a slot machine, pioneer. The jackpot is a finished phase, and it is on the other page.`,
  facts => `Still here. So is ${facts.phaseLabel}. Only one of you is getting any closer to done.`,
];

// Nothing to plan at all outranks a problem; a problem outranks the page you
// are actually looking at; general observations come last.
// Lower ranks first: lead -1, warn 0, a rule for the current page 1, a rule without `on` 2,
// a rule for another page 3.
const rank = (rule: AdaRule, view: string) =>
  rule.lead ? -1 : rule.tone === 'warn' ? 0 : !rule.on ? 2 : rule.on.includes(view) ? 1 : 3;
// Wraps index around the list (negative index too), so encores and faults cycle rather than run out.
// Both lists are fixed and not empty, so the pick always exists.
const pick = <T>(list: T[], index: number): T =>
  list[((index % list.length) + list.length) % list.length]!;
const safe = (line: (facts: AdaFacts) => string, facts: AdaFacts) => {
  try {
    return line(facts);
  } catch {
    return '';
  }
};

// Facts in, remarks out. Never throws: a joke must not be able to break the
// planner, so a rule that trips over unexpected data is skipped.
// `facts` comes from adaFacts in app/ada-panel.ts. Returns every applicable rule as
// { id, tone, text } in rank order, followed by all IDLE lines. The panel shows one at a time
// and restarts at the top when the list of ids changes.
//
// The tests pass only the facts a rule reads, so facts may be partial: a rule reading one that
// is missing throws and is skipped, the same as for unexpected data.
export function adaRemarks(given: Partial<AdaFacts> = {}): AdaLine[] {
  const facts = given as AdaFacts;
  const out: AdaLine[] = [];
  for (const rule of [...RULES].sort(
    (first, second) => rank(first, facts.view) - rank(second, facts.view),
  )) {
    try {
      if (rule.when(facts)) out.push({ id: rule.id, tone: rule.tone, text: rule.text(facts) });
    } catch {}
  }
  IDLE.forEach((text, i) => {
    try {
      out.push({ id: 'idle-' + i, tone: 'calm', text: text(facts) });
    } catch {}
  });
  return out;
}

// `lap` counts completed passes through the remarks, starting at 1.
// Shown by the panel in place of the first remark on every lap after the first.
export function adaEncore(lap: number, facts: Partial<AdaFacts> = {}): AdaLine {
  return {
    id: 'encore-' + lap,
    tone: 'calm',
    text: safe(pick(ENCORES, Math.max(0, lap - 1)), facts as AdaFacts),
  };
}

// `poke` counts badge prods, starting at 1. The last fault restores service, so
// a patient pioneer always ends back in corporate good standing.
// The panel calls this from the fifth quick poke on (poke = pokes - 4); past the last fault
// it wraps round to the first.
export function adaFault(poke: number): AdaLine {
  return {
    id: 'fault-' + poke,
    tone: 'fault',
    name: '???',
    text: pick(FAULTS, Math.max(0, poke - 1)),
  };
}
