// ADA, the sidebar assistant: remarks, muting and the poke easter egg.
// This module gathers facts about the open profile and renders the panel; the remark
// texts themselves are chosen in ../ada.js. The panel and its buttons are ui/AdaPanel.vue.
import { adaEncore, adaRemarks, adaFault as makeFault } from '../ada.js';
import { browserMode } from '../browser-api.js';
import { num, slug } from './format.js';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  currentSave,
  phase,
  phaseLabel,
  plan,
  planEditing,
  stage,
  startPhase,
  state,
  view,
  wizard,
  workspace,
} from './session.js';
import { render } from './shell.js';
import { planTasks, taskEditsState } from './tasks.js';
import { factoryGroupsState } from './views/factories.js';
import { storageBays } from './views/storage.js';
import { power } from './wizard/fields.js';
import { guidedFlow } from './wizard/guided.js';

// localStorage key for the mute switch ('muted' or 'on').
const ADA_KEY = 'planner-ada';
// Position in the remark cycle ("Another remark" advances it) and the ids of the remarks
// it was counted against, so a changed situation starts the cycle over.
export let adaIndex = 0;
let adaSignature = '';
export let adaMuted = adaStored();

// Other modules cannot assign imported bindings, so they change these through setters.
export function setAdaIndex(value) {
  adaIndex = value;
}
export function setAdaMuted(value) {
  adaMuted = value;
}

// The easter egg: clicking ADA's ◈ mark five times in quick succession shows a
// "transmission fault" line in place of the normal remark until it times out.
export let adaFault = null;
let adaFaultTimer;
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

// A snapshot of the open profile that ada.js picks remarks from: page, phase, progress
// counts, feasibility, power, backups. It re-derives the counters the pages show from
// the same checklist keys (factory-/calc-<stage>-<id>, slot-<address>-verified).
function adaFacts() {
  const ts = currentSave.id ? planTasks() : [];
  const next = ts.find(t => !checked(t.id));
  const x = calculated ? calcStage() : null;
  const rows = calculated ? x.rows || [] : plan.factories.filter(f => f.stages[stage()]);
  const runningKey = calculated
    ? r => 'calc-' + stage() + '-' + r.id
    : f => 'factory-' + stage() + '-' + f.id;
  const slots = storageBays()
    .flatMap(b => b.items)
    .filter(i => i.name);
  // Calculated delivery ids are <stage>-<slug(item)>, as in views/calculated.js.
  const deliveries = calculated
    ? Object.entries(x.delivery || {}).map(([n, d]) => ({
        id: stage() + '-' + slug(n),
        target: d.target,
        initial: 0,
      }))
    : plan.deliveries.filter(d => d.phase === phase());
  // Same default as ui/plan/DeliveryCounter.vue: the original handbook starts from its recorded amounts.
  const delivered = d =>
    state.deliveries[d.id] ?? (currentProfile.id === 'original' ? d.initial : 0);
  const spareMW = calculated ? (calculated.settings.availablePowerGW || 0) * 1000 : 0;
  const headroom = calculated ? x.additionalHeadroomMW || 0 : 0;
  // Plain data only; ada.js decides which remarks apply.
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
    steps: { done: ts.filter(t => checked(t.id)).length, total: ts.length },
    next: next?.title || '',
    retireOpen: ts.filter(t => t.id.startsWith('retire-') && !checked(t.id)).length,
    factories: { done: rows.filter(r => checked(runningKey(r))).length, total: rows.length },
    storage: {
      done: slots.filter(i => checked('slot-' + i.id + '-verified')).length,
      total: slots.length,
    },
    deliveries: {
      open: deliveries.filter(d => delivered(d) < d.target).length,
      total: deliveries.length,
    },
    hasPhaseNote: !!state.notes['phase-' + phase()],
    customTasks: state.customTasks.filter(t => t.phase === phase()).length,
    removedSteps: taskEditsState().removed.length,
    groups: factoryGroupsState().groups.length,
    feasible: calculated ? x.feasible !== false : true,
    reason: calculated ? x.reason || '' : '',
    // Raw resources this stage uses beyond the profile's resource limits.
    short: calculated
      ? (workspace.catalog?.raw || []).filter(
          n => (x.raw?.[n] || 0) > (calculated.settings.limits?.[n] ?? Infinity),
        )
      : [],
    power:
      headroom > 0.01
        ? {
            required: power(x.requiredMW || 0),
            spare: power(spareMW),
            headroom: power(headroom),
            tight: true,
          }
        : null,
    hours: calculated && x.hours ? num(x.hours) + ' h' : '',
    profiles: workspace.saves.find(s => s.id === currentSave.id)?.profiles.length || 0,
    backupDays: workspace.lastBackup
      ? Math.max(0, Math.floor((Date.now() - new Date(workspace.lastBackup).getTime()) / 86400000))
      : null,
    post: phase() === 'post',
    startPhase: startPhase(),
    assumptions: calculated ? (calculated.warnings || []).length : 0,
  };
}

// A changed situation deserves the most relevant line, so the cycle restarts
// whenever the set of applicable remarks changes. Cycling past the end of the
// list is not an error: ADA has something to say about that too.
export function adaCurrent() {
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
    at = adaIndex % list.length;
  return lap > 0 && !at ? adaEncore(lap, facts) : list[at];
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
    const r = adaCurrent();
    return r ? { tone: r.tone, name: r.name || '', text: r.text } : null;
  } catch {
    return null;
  }
}
