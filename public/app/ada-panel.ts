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
import { stageSupply } from './build-status.ts';
import { durationOfHours, num, slug } from './format.ts';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  currentSave,
  milestoneOnly,
  openedFrom,
  payoff,
  phase,
  phaseLabel,
  plan,
  planEditing,
  query,
  stage,
  startPhase,
  state,
  view,
  wizard,
  workspace,
} from './session.ts';
import { payoffBest, payoffDefaultSort } from './payoff.ts';
import { render } from './shell.ts';
import { planTasks, removedPlanTasks } from './tasks.ts';
import { backupDays } from './views/backup.ts';
import { currentBuildStatus } from './views/calculated.ts';
import { factoryGroupsState } from './views/factories.ts';
import { groundMovesPending, storageBays, storageMatches } from './views/storage.ts';
import { power } from './wizard/fields.ts';
import { guidedFlow } from './wizard/guided.ts';
import type { StageDelivery, StoredStage } from '../types/index.ts';

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
// ADA's view of the build-so-far status (views/calculated.ts), with row ids turned into names.
function buildFacts(storedStage: StoredStage): AdaFacts['build'] {
  const status = currentBuildStatus();
  if (!status) return null;
  const name = (id: string) => storedStage.rows?.find(r => r.id === id)?.name || id;
  const held = status.rows.filter(r => r.built && r.share < 1 && r.shortOf);
  return {
    built: status.builtCount,
    total: status.rowCount,
    share: Math.round(status.deliveryShare * 100),
    next: status.next ? name(status.next.id) : '',
    nextGain: status.next
      ? Math.max(status.next.gain > 0 ? 1 : 0, Math.round(status.next.gain * 100))
      : 0,
    nextUnblocks: status.next?.unblocks || 0,
    waiting: held.map(r => name(r.id)),
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
  const next = steps.find(t => !checked(t.id));
  // Read only with a calculated profile open; an empty stage stands in if its data is missing. A
  // milestone-only phase (#759) has no stage of its own, which is not a failed plan: it stands in
  // as feasible, with nothing in it.
  const milestones = milestoneOnly();
  const storedStage: StoredStage = calcStage() ?? { feasible: milestones };
  const rows: { id: string }[] = calculated
    ? storedStage.rows || []
    : plan.factories.filter(f => f.stages[stage()]);
  const runningKey = (row: { id: string }) =>
    (calculated ? 'calc-' : 'factory-') + stage() + '-' + row.id;
  const slots = storageBays()
    .flatMap(b => b.items)
    .filter(i => i.name);
  // Calculated delivery ids are <stage>-<slug(item)>, as in views/calculated.ts.
  const deliveries = calculated
    ? Object.entries<StageDelivery>(storedStage.delivery || {}).map(([item, delivery]) => ({
        id: stage() + '-' + slug(item),
        target: delivery.target,
        initial: 0,
      }))
    : plan.deliveries.filter(d => d.phase === phase());
  // Same default as ui/plan/DeliveryCounter.vue: the original handbook starts from its recorded amounts.
  const delivered = (delivery: { id: string; initial: number }) =>
    state.deliveries[delivery.id] ?? (currentProfile.kind === 'original' ? delivery.initial : 0);
  const spareMW = calculated ? (calculated.settings.availablePowerGW || 0) * 1000 : 0;
  const headroom = calculated ? storedStage.additionalHeadroomMW || 0 : 0;
  // What the stage's power is balanced against, as build-status.ts measures it (#334).
  const supply = stageSupply(storedStage, spareMW);
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
    supplyDeclared: Object.keys(wizard?.settings?.existingSupply || {}).length,
    kind: currentSave.id ? currentProfile?.kind || 'original' : 'none',
    save: currentSave.name || 'this save',
    profile: currentProfile?.name || 'Pioneer',
    steps: { done: steps.filter(t => checked(t.id)).length, total: steps.length },
    next: next?.title || '',
    retireOpen: steps.filter(t => t.id.startsWith('retire-') && !checked(t.id)).length,
    factories: { done: rows.filter(r => checked(runningKey(r))).length, total: rows.length },
    storage: {
      done: slots.filter(i => checked('slot-' + i.id + '-verified')).length,
      total: slots.length,
    },
    storageMiss: view === 'storage' && query && !storageMatches(query).length ? query : '',
    groundMoves: groundMovesPending(),
    guide: guideFacts(),
    deliveries: {
      open: deliveries.filter(d => delivered(d) < d.target).length,
      total: deliveries.length,
    },
    hasPhaseNote: !!state.notes['phase-' + phase()],
    unplaced: unplacedCount(),
    customTasks: state.customTasks.filter(t => t.phase === phase()).length,
    removedSteps: removedPlanTasks().length,
    groups: factoryGroupsState().groups.length,
    feasible: calculated ? storedStage.feasible !== false : true,
    reason: calculated ? storedStage.reason || '' : '',
    // Raw resources this stage uses beyond the profile's resource limits.
    short: calculated
      ? (workspace.catalog?.raw || []).filter(
          resource =>
            (storedStage.raw?.[resource] || 0) >
            (calculated?.settings.limits?.[resource] ?? Infinity),
        )
      : [],
    power:
      headroom > 0.01
        ? {
            required: power(storedStage.requiredMW || 0),
            generation: supply.generationMW > 0.01 ? power(supply.generationMW) : '',
            spare: power(spareMW),
            augmented: supply.spareMW - spareMW > 0.01 ? power(supply.spareMW) : '',
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
    profiles: workspace.saves.find(s => s.id === currentSave.id)?.profiles.length || 0,
    backupDays: backupDays(workspace.lastBackup),
    post: phase() === 'post',
    startPhase: startPhase(),
    milestoneOnly: milestones ? phaseLabel(startPhase()) : '',
    openedFrom: savedPhase ? phaseLabel(savedPhase) : '',
    assumptions: calculated ? (calculated.warnings || []).length : 0,
    build: buildFacts(storedStage),
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
