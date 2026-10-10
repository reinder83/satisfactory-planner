// ADA, the sidebar assistant: remarks, muting and the poke easter egg.
// This module gathers facts about the open profile and renders the panel; the remark
// texts themselves are chosen in ../ada.ts. The panel and its buttons are ui/AdaPanel.vue.
import {
  adaEncore,
  adaRemarks,
  adaFault as makeFault,
  type AdaFacts,
  type AdaLine,
} from '../ada.ts';
import { browserMode } from '../browser-api.ts';
import { noteConflicts } from './api.ts';
import { ownedBeyondKept, powerView } from '../power.ts';
import { deliveryKey } from '../progression.ts';
import { durationOfHours, num, plural } from './format.ts';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  currentSave,
  groupMoved,
  importedSaves,
  milestoneOnly,
  openedFrom,
  payoff,
  phase,
  phaseLabel,
  planEditing,
  query,
  requiredOnly,
  stage,
  startPhase,
  state,
  view,
  wizard,
  workspace,
} from './session.ts';
import { groupsReorder } from './group-order.ts';
import { exactClocksChange, roundingCost } from './exact-clocks.ts';
import { onSiteChange } from './on-site-picker.ts';
import { payoffBest, payoffDefaultSort } from './payoff.ts';
import { render } from './shell.ts';
import { idleStepNotes, planTasks, removedPlanTasks, stepDone, taskEditsState } from './tasks.ts';
import { backupDays } from './views/backup.ts';
import { buildRowName, currentBuildStatus } from './views/calculated.ts';
import { byproductCount } from './recycle.ts';
import { handoverLines } from './handover.ts';
import { factoryGroupsState } from './views/factories.ts';
import { storageBays, storageMatches } from './views/storage.ts';
import { power } from './wizard/fields.ts';
import { guidedFlow } from './wizard/guided.ts';
import { listNames } from '../wording.ts';
import { minerWords, stageMiningAdvice } from '../mining.ts';
import { OWNED_GENERATORS, phaseBelt } from '../preferences.ts';
import type { OnSiteSettings, StageDelivery, StoredStage } from '../types/index.ts';

// localStorage key for the mute switch ('muted' or 'on').
const ADA_KEY = 'planner-ada';
// Position in the remark cycle ("Another remark" advances it) and the ids of the remarks
// it was counted against, so a changed situation starts the cycle over.
export let adaIndex = 0;
let adaSignature = '';
export let adaMuted = adaStored();

// Other modules cannot assign imported bindings, so they change these through setters.
export function setAdaIndex(value: number) {
  adaIndex = value;
}
export function setAdaMuted(value: boolean) {
  adaMuted = value;
}

export type { AdaLine };

// The easter egg: clicking ADA's ◈ mark five times in quick succession shows a
// "transmission fault" line in place of the normal remark until it times out.
export let adaFault: AdaLine | null = null;
let adaFaultTimer: ReturnType<typeof setTimeout> | undefined;
let adaPokes = 0;
let adaPokedAt = 0;

// ── ADA ────────────────────────────────────────────────
// The assistant reads the same counters the pages show; it is a voice over the
// plan, never a second source of truth for it.
// The mute switch is a view preference rather than progress, so it stays in
// this browser and never touches a saved profile.
function adaStored() {
  try {
    return localStorage.getItem(ADA_KEY) === 'muted';
  } catch {
    return false;
  }
}

export function adaStore() {
  try {
    localStorage.setItem(ADA_KEY, adaMuted ? 'muted' : 'on');
  } catch {}
}

// A snapshot of the open profile that ada.ts picks remarks from: page, phase, progress
// counts, feasibility, power, backups. It re-derives the counters the pages show from
// the same checklist keys (factory-/calc-<stage>-<id>, slot-<address>-verified).
// ADA's view of the build-so-far status (views/calculated.ts), with row ids turned into names
// as the build plan's steps give them ("Wire for Alpha", #911).
function buildFacts(): AdaFacts['build'] {
  const status = currentBuildStatus();
  if (!status) return null;
  const held = status.rows.filter(r => r.built && r.share < 1 && r.shortOf);
  return {
    built: status.builtCount,
    total: status.rowCount,
    share: Math.round(status.deliveryShare * 100),
    next: status.next ? buildRowName(status.next.id) : '',
    nextGain: status.next
      ? Math.max(status.next.gain > 0 ? 1 : 0, Math.round(status.next.gain * 100))
      : 0,
    nextUnblocks: status.next?.unblocks || 0,
    waiting: held.map(r => buildRowName(r.id)),
    shortOf: [...new Set(held.map(r => r.shortOf!))],
    powerShort: status.power.short,
  };
}

// ADA's view of a stored hard-drive payoff ranking of this phase (app/payoff.ts): the best
// alternate on what the profile's goal optimises, and by how much.
function payoffFacts(): AdaFacts['payoff'] {
  if (!calculated || milestoneOnly() || payoff?.ranking.phase !== stage()) return null;
  const column = payoffDefaultSort(calculated.settings.goal);
  const best = payoffBest(payoff.ranking, column);
  if (!best) return null;
  const gain = -(best[column] ?? 0);
  return {
    name: best.name,
    gain:
      column === 'hours'
        ? `${num(gain)} ${gain === 1 ? 'hour' : 'hours'} sooner`
        : `${num(gain)} fewer ${gain === 1 ? 'building' : 'buildings'}`,
  };
}

// The items a stage makes centrally because its groups' own lines did not fit (#875), and those
// groups by the names the plan was calculated with. Also the items whose groups' excess meets the
// central demand (#1063, stage.onSiteOverflow), which have the same shape.
function onSiteDroppedFacts(
  dropped: Record<string, string[]>,
  onSite: OnSiteSettings | undefined,
): NonNullable<AdaFacts['onSiteDropped']> {
  const items = [...new Set(Object.values(dropped).flat())].sort();
  const groups = Object.keys(dropped).map(group => onSite?.[group]?.name || 'a factory');
  return { items: listNames(items), groups: listNames(groups) };
}

// The Water the open phase extracts (#1024), written as the pages write a rate; none without.
function waterFacts(): Pick<AdaFacts, 'waterExtracted'> {
  const water = calcStage()?.raw?.Water ?? 0;
  return water > 0 ? { waterExtracted: num(water) } : {};
}

// The handover from the phase before (#1069), as each factory's Handover on the Factories page
// counts it (handoverLines in handover.ts): the lines kept running and those with something to
// add or change. None where nothing is handed over or nothing is kept.
function handoverFacts(): Pick<AdaFacts, 'handover'> {
  const handover = calculated && handoverLines(calculated, state.checks, phase());
  if (!handover) return {};
  const kept = handover.lines.filter(line => line.status === 'keep' || line.status === 'add');
  if (!kept.length) return {};
  const changed = kept.filter(line => line.status === 'add').length;
  return { handover: { from: handover.from, kept: kept.length, changed } };
}

// The open phase's mining (#1065): its miner, the nodes its draw taps and their MW, from the
// advice the Resources page and the build plan give (stageMiningAdvice); none without mining per
// phase or anything to mine. With it, the belt the player already has (#1068) where it is better
// than the one the phase's milestones give.
function miningFacts(): Pick<AdaFacts, 'mining' | 'ownedBelt'> {
  const stagePlan = calcStage(),
    resources = stageMiningAdvice(stagePlan);
  if (!stagePlan?.mining || !resources.length) return {};
  const nodes = resources.reduce((sum, entry) => sum + entry.advice.nodes, 0),
    satellites = resources.reduce((sum, entry) => sum + entry.advice.satellites, 0);
  return {
    mining: {
      miner: minerWords(stagePlan.mining.miner),
      nodes: listNames([
        ...(nodes ? [plural(nodes, 'node')] : []),
        ...(satellites ? [plural(satellites, 'well satellite')] : []),
      ]),
      mw: power(resources.reduce((sum, entry) => sum + entry.advice.mw, 0)),
    },
    ...(stagePlan.mining.belt.mark !== phaseBelt(Number(stage())).mark
      ? { ownedBelt: `${stagePlan.mining.belt.mark} belts (${num(stagePlan.mining.belt.cap)}/min)` }
      : {}),
  };
}

// The generators the phase before built that the open phase keeps (#1064, the stage's grid), as
// "7 Fuel Generators", with that phase; none for a plan without a grid or a phase keeping none.
function keptFacts(storedStage: StoredStage): Pick<AdaFacts, 'keptGenerators' | 'keptFrom'> {
  const kept = (storedStage.grid?.generators || []).filter(entry => entry.kept > 0);
  if (!kept.length) return {};
  return {
    keptGenerators: listNames(
      kept.map(entry => `${num(entry.kept)} ${entry.machine}${entry.kept === 1 ? '' : 's'}`),
    ),
    keptFrom: 'Phase ' + (Number(stage()) - 1),
  };
}

// The generators the player already has (#1068, settings.ownedGenerators) that the open phase
// counts beyond the kept ones (ownedBeyondKept), as "4 Coal Generators", and those of a building
// unlocked by this phase that it runs none of, which it does not count; none for a plan without
// a grid, or before the start phase. Biomass Burners stay out of both: the burner bank counts them.
function ownedGeneratorFacts(
  storedStage: StoredStage,
): Pick<AdaFacts, 'ownedGenerators' | 'idleGenerators'> {
  const owned = calculated?.settings.ownedGenerators,
    phaseNumber = Number(stage());
  if (!owned || !storedStage.grid || phaseNumber < Number(calculated?.settings.phase || 1))
    return {};
  const named = (count: number, machine: string) =>
    `${num(count)} ${machine}${count === 1 ? '' : 's'}`;
  const counted = ownedBeyondKept(storedStage.grid),
    running = storedStage.grid.generators.map(entry => entry.machine);
  const idle = OWNED_GENERATORS.filter(
    kind =>
      kind.machine !== 'Biomass Burner' &&
      kind.phase <= phaseNumber &&
      (owned[kind.machine] ?? 0) > 0 &&
      !running.includes(kind.machine),
  );
  return {
    ...(counted.length
      ? { ownedGenerators: listNames(counted.map(entry => named(entry.owned ?? 0, entry.machine))) }
      : {}),
    ...(idle.length
      ? {
          idleGenerators: listNames(
            idle.map(kind => named(owned[kind.machine] ?? 0, kind.machine)),
          ),
        }
      : {}),
  };
}

// Whether the plan waits for a recalculation of the lines its groups make on site (onSiteChange,
// #877), and whether that is only because a group's lines no longer use, or now use, an item it
// marks, with no change to the marks (#985), so ADA words it as the notice does.
function onSitePendingFacts(): Pick<AdaFacts, 'onSitePending' | 'onSiteLinesOnly'> {
  const change = calculated ? onSiteChange(calculated, factoryGroupsState()) : null;
  return { onSitePending: !!change, onSiteLinesOnly: !!change && !change.marksChanged };
}

// The lines a recalculation with the clocks asked for would change (exactClocksChange, #1066), and
// what whole machines cost in the open phase (roundingCost), in the side column's words: more
// buildings and power than exact clocks, only where the whole-machine plan takes more.
function exactClockFacts(): Pick<AdaFacts, 'exactClocksPending' | 'roundingCost'> {
  const change = calculated ? exactClocksChange(calculated, state) : null;
  const cost = roundingCost(calcStage());
  const more = cost && cost.buildings[0] - cost.buildings[1];
  return {
    ...(change ? { exactClocksPending: change.exact.length + change.whole.length } : {}),
    ...(cost && more && more > 0
      ? {
          roundingCost: {
            buildings: plural(more, 'building'),
            power: power(Math.max(0, cost.needMW[0] - cost.needMW[1])),
          },
        }
      : {}),
  };
}

// Where the user's other tabs or devices moved (#1052), as the notice names it.
function groupMovedFact(): string {
  const moved = groupMoved();
  if (!moved) return '';
  return `“${moved.profileName}”` + (moved.otherSave ? ` in “${moved.saveName}”` : '');
}

// A plan guide's checklists as ticked of all (#470), counted from the same keys the pages tick.
function guideFacts(): AdaFacts['guide'] {
  const guide = calculated?.guide;
  if (!guide) return null;
  const count = (ids: string[]) => ({ done: ids.filter(checked).length, total: ids.length });
  return {
    power: count((guide.power?.checks || []).map(c => c.id)),
    storageTasks: count((guide.storageTasks || []).map(t => t.id)),
    completion: count((guide.completion || []).map(c => 'completion-' + c.id)),
  };
}

// The ticks, notes and group assignments the move from the original plan could not place, which
// the Notes page lists (ui/notes/UnplacedRecords.vue, #499).
function unplacedCount(): number {
  const unmapped = state.handbookOrigin?.unmapped;
  if (!unmapped) return 0;
  return [unmapped.checks, unmapped.notes, unmapped.assignments].reduce(
    (total, records) => total + Object.keys(records || {}).length,
    0,
  );
}

function adaFacts(): AdaFacts {
  const steps = currentSave.id ? planTasks() : [];
  // The next step leaves out the lines a delivered elevator part leaves without work (#1062), as
  // the build plan's lead step does, unless nothing else is left.
  const idle = idleStepNotes(steps),
    idleOpen = steps.filter(t => idle.has(t.id) && !stepDone(t)).length;
  // A step done by its own condition (stepDone, #1070) is done, as the build plan shows it.
  const next = steps.find(t => !stepDone(t) && !idle.has(t.id)) ?? steps.find(t => !stepDone(t));
  // Read only with a calculated profile open; an empty stage stands in if its data is missing. A
  // milestone-only phase (#759) has no stage of its own, which is not a failed plan: it stands in
  // as feasible, with nothing in it.
  const milestones = milestoneOnly();
  const storedStage: StoredStage = calcStage() ?? { feasible: milestones };
  const rows: { id: string }[] = storedStage.rows || [];
  const runningKey = (row: { id: string }) => 'calc-' + stage() + '-' + row.id;
  const slots = storageBays()
    .flatMap(b => b.items)
    .filter(i => i.name);
  // Calculated delivery ids are <stage>-<slug(item)> (deliveryKey).
  const deliveries = Object.entries<StageDelivery>(storedStage.delivery || {}).map(
    ([item, delivery]) => ({ id: deliveryKey(stage(), item), target: delivery.target }),
  );
  // Same default as ui/plan/DeliveryCounter.vue: a delivery with no saved count has none yet.
  const delivered = (delivery: { id: string }) => state.deliveries[delivery.id] ?? 0;
  // The stage's power as every page gives it (powerView in public/power.ts, #1064): what it
  // needs, its new generation and the spare power, with what the augmenters add (#334).
  const grid = calculated ? powerView(storedStage, calculated.settings) : null;
  const headroom = grid?.shortMW ?? 0;
  const savedPhase = openedFrom();
  // Plain data only; ada.ts decides which remarks apply.
  return {
    view,
    phaseLabel: phaseLabel(phase()),
    browserMode,
    planEditing,
    guided: wizard?.mode === 'guided',
    guidedStep: wizard?.guidedStep || 0,
    guidedTotal: wizard ? guidedFlow().length : 0,
    tutorialDone: wizard?.tutorial === 'done',
    guidedHave: wizard?.mode === 'guided' && guidedFlow()[wizard.guidedStep - 1]?.kind === 'have',
    ownedAlternates: wizard?.ownedAlternates?.length ?? 0,
    earlierDone:
      wizard?.earlierDone && wizard.preview
        ? phaseLabel(String(wizard.preview.settings.phase))
        : '',
    supplyDeclared: Object.keys(wizard?.settings?.existingSupply || {}).length,
    kind: currentSave.id ? 'calculated' : 'none',
    save: currentSave.name || 'this save',
    profile: currentProfile?.name || 'Pioneer',
    steps: { done: steps.filter(stepDone).length, total: steps.length },
    next: next?.title || '',
    retireOpen: steps.filter(t => t.id.startsWith('retire-') && !checked(t.id)).length,
    idleLines: idleOpen,
    stockLines: (storedStage.rows || []).filter(row => row.stock && !checked(runningKey(row)))
      .length,
    optionalResearch: steps.filter(t => t.optional && t.id.startsWith('unlock-') && !checked(t.id))
      .length,
    requiredOnly,
    ...keptFacts(storedStage),
    ...ownedGeneratorFacts(storedStage),
    factories: { done: rows.filter(r => checked(runningKey(r))).length, total: rows.length },
    storage: {
      done: slots.filter(i => checked('slot-' + i.id + '-verified')).length,
      total: slots.length,
    },
    storageMiss: view === 'storage' && query && !storageMatches(query).length ? query : '',
    guide: guideFacts(),
    deliveries: {
      open: deliveries.filter(d => delivered(d) < d.target).length,
      total: deliveries.length,
    },
    hasPhaseNote: !!state.notes['phase-' + phase()],
    noteConflicts: noteConflicts(),
    groupMoved: groupMovedFact(),
    imported: listNames(
      workspace.saves.filter(save => importedSaves.includes(save.id)).map(save => `“${save.name}”`),
    ),
    unplaced: unplacedCount(),
    siteReview: Object.keys(state.onSiteReview?.checks || {}).length,
    ...onSitePendingFacts(),
    ...exactClockFacts(),
    byproducts: byproductCount(calcStage() ?? { feasible: false }),
    ...waterFacts(),
    ...handoverFacts(),
    ...miningFacts(),
    customTasks: state.customTasks.filter(t => t.phase === phase()).length,
    removedSteps: removedPlanTasks().length,
    groups: factoryGroupsState().groups.length,
    groupedSteps:
      factoryGroupsState().groups.length > 0 &&
      !calculated?.guide &&
      !milestoneOnly() &&
      !taskEditsState().order[phase()]?.length &&
      // Only when the groups change the planner's order: groups with no rows assigned, or rows
      // that already go group by group, leave it as it was (#869).
      groupsReorder(calcStage()?.rows || [], state.factoryGroups),
    feasible: calculated ? storedStage.feasible !== false : true,
    reason: calculated ? storedStage.reason || '' : '',
    // Raw resources this stage uses beyond its budgets: the phase's own with mining per phase
    // (#1065), else the profile's resource limits.
    short: calculated
      ? (workspace.catalog?.raw || []).filter(
          resource =>
            (storedStage.raw?.[resource] || 0) >
            (storedStage.mining?.budgets[resource] ??
              calculated?.settings.limits?.[resource] ??
              Infinity),
        )
      : [],
    // A shortfall is only measured with a calculated profile, so `grid` is there below.
    power:
      headroom > 0.01
        ? {
            required: power(grid!.needMW),
            generation: grid!.generationMW > 0.01 ? power(grid!.generationMW) : '',
            spare: power(grid!.spareMW),
            augmented: grid!.augmenterMW > 0.01 ? power(grid!.spareMW + grid!.augmenterMW) : '',
            headroom: power(headroom),
            biomass: stage() === '1',
            tight: true,
          }
        : null,
    hours: calculated && storedStage.hours ? durationOfHours(storedStage.hours) : '',
    rounded:
      calculated && storedStage.feasible && storedStage.roundedAfterStop !== undefined
        ? {
            target: durationOfHours(storedStage.roundedAfterStop),
            longer: (storedStage.hours || 0) > storedStage.roundedAfterStop * 1.01,
          }
        : null,
    fractional:
      calculated && storedStage.feasible && storedStage.fractionalAfterStop
        ? {
            target: durationOfHours(storedStage.fractionalAfterStop.target),
            longer: (storedStage.hours || 0) > storedStage.fractionalAfterStop.target * 1.01,
            clocks: storedStage.fractionalAfterStop.clocks,
          }
        : null,
    onSiteDropped:
      calculated && storedStage.feasible && storedStage.onSiteDropped
        ? onSiteDroppedFacts(storedStage.onSiteDropped, calculated.settings.onSite)
        : null,
    onSiteOverflow:
      calculated && storedStage.feasible && storedStage.onSiteOverflow
        ? onSiteDroppedFacts(storedStage.onSiteOverflow, calculated.settings.onSite)
        : null,
    profiles: workspace.saves.find(s => s.id === currentSave.id)?.profiles.length || 0,
    backupDays: backupDays(workspace.lastBackup),
    post: phase() === 'post',
    startPhase: startPhase(),
    milestoneOnly: milestones ? phaseLabel(startPhase()) : '',
    openedFrom: savedPhase ? phaseLabel(savedPhase) : '',
    assumptions: calculated ? (calculated.warnings || []).length : 0,
    build: buildFacts(),
    payoff: payoffFacts(),
  };
}

// A changed situation deserves the most relevant line, so the cycle restarts
// whenever the set of applicable remarks changes. Cycling past the end of the
// list is not an error: ADA has something to say about that too.
export function adaCurrent(): AdaLine | null {
  if (adaFault) return adaFault;
  const facts = adaFacts(),
    list = adaRemarks(facts);
  if (!list.length) return null;
  const signature = list.map(r => r.id).join('|');
  if (signature !== adaSignature) {
    adaSignature = signature;
    adaIndex = 0;
  }
  const lap = Math.floor(adaIndex / list.length),
    position = adaIndex % list.length;
  // position is below list.length, so list[position] is a remark.
  return lap > 0 && !position ? adaEncore(lap, facts) : list[position]!;
}

// Prodding the badge is the only way to reach these, and the last one restores
// normal service, so nobody is stranded in a corrupted transmission.
export function adaClearFault() {
  clearTimeout(adaFaultTimer);
  adaFault = null;
  adaPokes = 0;
}

// Counts clicks on the ◈ mark (ui/AdaPanel.vue); a gap over 2.5 s starts the count over.
// From the fifth click on, each shows the next fault line, cleared after 12 seconds.
export function adaPoke() {
  clearTimeout(adaFaultTimer);
  adaPokes = Date.now() - adaPokedAt > 2500 ? 1 : adaPokes + 1;
  adaPokedAt = Date.now();
  if (adaPokes < 5) return;
  adaFault = makeFault(adaPokes - 4);
  adaFaultTimer = setTimeout(() => {
    adaClearFault();
    render();
  }, 12000);
  render();
}

// What the ADA panel shows, drawn by ui/AdaPanel.vue: { muted: true } while muted,
// otherwise the current remark's { tone, name, text } (name is set only for a fault line),
// or null when there is nothing to say. Any error yields null, so the assistant can never
// break the page around it.
export function adaView() {
  try {
    if (adaMuted) return { muted: true };
    const remark = adaCurrent();
    return remark ? { tone: remark.tone, name: remark.name || '', text: remark.text } : null;
  } catch {
    return null;
  }
}
