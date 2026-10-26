// What to do about a phase that does not fit (#1222, slice 4 of #1078): the advice under an
// infeasible phase's reason on the plan, factories and resources pages (ui/plan/CalcWarnings.vue)
// and the wizard's Review (ui/wizard/ReviewStep.vue), both drawn by ui/plan/DraftAdvice.vue.
// Presentation of what the planner already measured: its draft (planner/draft.ts) names each short
// resource with the amount the phase needs and its budget, the hours the phase would fit in, and
// keeps the rows of the plan the goal would need. Nothing here solves or stores anything.
//
// Two parts:
// - `needs`: each short resource, what the phase needs against what the map gives at the nodes
//   the plan may tap (mapSupply in public/preferences/mining.ts: the node survey less the nodes
//   it leaves out, else the world's known counts, never an estimate), and how much of it the
//   draft burns for power.
// - `levers`: the settings that would help, only those that apply to the phase and its unlocks,
//   each with the step of Edit settings that holds it, and for more time the hours that fit.
// It reads the draft's fields, not its reason sentence, so a reason of a kind added later (a cap
// on buildings or power, #1221) gets the levers its fields call for and no others.
import { num } from './format.ts';
import { power as powerWords } from './wizard/fields.ts';
import { recipeIdOf } from '../progression.ts';
import { sloopPayoffOf, sloopUpstream, takesSloops } from './sloop-payoff.ts';
import { listNames } from '../wording.ts';
import { minerWords } from '../mining.ts';
import {
  beltCapMark,
  driveCapWords,
  mapSupply,
  phaseBelt,
  phaseCapAmount,
  phaseShare,
  rawResources,
} from '../preferences.ts';
import { AMPLIFIER_PHASE, AMPLIFIER_RESEARCH } from '../somersloops.ts';
import type {
  CalcRow,
  CatalogRecipe,
  CurrentSettings,
  Shortfall,
  StoredStage,
} from '../types/index.ts';

// One short resource of a draft: what the phase needs (`needed`, "at least" when `atLeast`), what
// the map gives at the nodes the plan may tap (null when no count is known), whether that is less
// than the budget would have to be (`overMap`: no budget fits it), how much of the need is fuel
// for power, and the line the notice shows.
export interface DraftNeed {
  name: string;
  needed: number;
  atLeast: boolean;
  map: number | null;
  overMap: boolean;
  power: number;
  text: string;
}
// One option: its text, and where the app already has the action. `step` opens Edit settings on
// that step with `label` on the button; `hours` is the time lever's recalculation in place at the
// hours per phase that fit.
export type DraftLeverId =
  | 'budget'
  | 'whole'
  | 'time'
  | 'demands'
  | 'alternates'
  | 'amplify'
  | 'sam'
  | 'nuclear'
  | 'buildCost'
  | 'beltCap'
  | 'driveCap'
  | 'phaseCap';
export interface DraftLever {
  id: DraftLeverId;
  text: string;
  step?: 1 | 2 | 3 | 4;
  label?: string;
  hours?: number;
}
export interface DraftAdvice {
  needs: DraftNeed[];
  levers: DraftLever[];
}
// What the advice reads besides the draft and its settings: the phase (1 to 5) and the catalog's
// alternate recipes, for the levers that depend on them.
export interface DraftAdviceContext {
  phase?: number;
  alternates?: readonly CatalogRecipe[];
}
type DraftSettings = Partial<CurrentSettings> | undefined;

// A raw resource's rate as the rate lists write it (itemRate and rateOfItem in app/flow.ts, which
// this module does not import, so the node tests can load it): "900/min" and "900 Bauxite/min",
// with m³ for the raw resources that are fluids.
const DRAFT_FLUIDS = ['Water', 'Crude Oil', 'Nitrogen Gas'];
const draftRate = (item: string, rate: number): string =>
  num(rate) + (DRAFT_FLUIDS.includes(item) ? ' m³/min' : '/min');
const draftRateOf = (item: string, rate: number): string =>
  `${num(rate)}${DRAFT_FLUIDS.includes(item) ? ' m³' : ''} ${item}/min`;

// A share of a need below this is noise: it does not name power, and an alternate saving less is
// not offered.
const DRAFT_NOTICEABLE = 0.05;
// How many alternates the alternates lever names.
const DRAFT_ALTERNATES = 3;

// The share of a short resource's entered budget the phase gets with mining per phase (#1065):
// its budget over the entered one, or, for an entered budget of none (#1185), the share its
// equipment would give any budget (phaseShare), when the phase is known. 0 without mining per
// phase or where the phase gets none of it.
function draftShare(
  shortfall: Shortfall,
  snapshot: StoredStage,
  settings: DraftSettings,
  phase?: number,
): number {
  const limits = settings?.limits;
  const entered = limits?.[shortfall.name];
  if (!snapshot.mining || !limits || entered === undefined) return 0;
  if (shortfall.budget > 0 && entered > 0) return shortfall.budget / entered;
  return entered === 0 && phase !== undefined && phase >= 1 && phase <= 5
    ? phaseShare({ ...settings, limits }, phase, shortfall.name)
    : 0;
}
// The entered budget a phase's need takes: with mining per phase the entered budget the phase's
// share needs (draftShare); else the need itself.
function draftEnteredNeed(
  shortfall: Shortfall,
  snapshot: StoredStage,
  settings: DraftSettings,
  phase?: number,
) {
  const share = draftShare(shortfall, snapshot, settings, phase);
  return share > 0 ? Math.ceil(shortfall.needed / share) : shortfall.needed;
}

// Per raw resource, what the draft's generators burn of it per minute, upstream included: each
// generator line's inputs at the cost the draft's own lines give them (sloopUpstream).
function draftPowerDraw(snapshot: StoredStage, settings: DraftSettings): Map<string, number> {
  const draw = new Map<string, number>();
  const generators = (snapshot.rows || []).filter(
    row => (row.generationMW || 0) > 0 || row.power < 0,
  );
  if (!generators.length) return draw;
  const costs = sloopUpstream(snapshot, settings ?? {});
  for (const row of generators)
    for (const [input, amount] of Object.entries(row.inputs || {}))
      for (const [resource, rate] of costs.get(input)?.raw ?? [])
        draw.set(resource, (draw.get(resource) ?? 0) + amount * rate);
  return draw;
}

// The short resources of a draft as DraftNeed (see the header); none for a draft without them.
export function draftNeeds(
  snapshot: StoredStage,
  settings: DraftSettings,
  phase?: number,
): DraftNeed[] {
  const shortfalls = snapshot.shortfalls || [];
  if (!shortfalls.length) return [];
  const powerDraw = draftPowerDraw(snapshot, settings);
  return shortfalls.map(shortfall => {
    const { name } = shortfall;
    const supply = settings ? mapSupply(settings, name) : null;
    const atLeast = !!shortfall.atLeast;
    const overMap =
      !!supply &&
      supply.wells &&
      draftEnteredNeed(shortfall, snapshot, settings, phase) > supply.total;
    const power = Math.min(shortfall.needed, powerDraw.get(name) ?? 0);
    const parts = [
      `${name}: needs ${atLeast ? 'at least' : 'about'} ${draftRate(name, shortfall.needed)}`,
    ];
    if (snapshot.mining && shortfall.budget > 0)
      parts.push(
        `; this phase gets ${draftRate(name, shortfall.budget)} with ${minerWords(snapshot.mining.miner)}`,
      );
    if (supply)
      parts.push(
        `; the map gives ${draftRate(name, Math.floor(supply.total))} at the nodes you allow (${minerWords(supply)}${supply.wells ? '' : ', oil nodes only: count resource wells in the node survey'})`,
        overMap ? ', so a higher budget alone will not fit it' : '',
      );
    else if (name !== 'Water')
      parts.push('; the map total is not known for this world: count its nodes in the node survey');
    parts.push('.');
    if (power >= DRAFT_NOTICEABLE * shortfall.needed && power >= 1)
      parts.push(` About ${draftRate(name, Math.round(power))} of it is fuel for power.`);
    return {
      name,
      needed: shortfall.needed,
      atLeast,
      map: supply?.total ?? null,
      overMap,
      power,
      text: parts.join(''),
    };
  });
}

// One short budget in the budget lever's words: "Iron Ore to about 1,200/min (entered:
// 1,000/min)". With mining per phase (#1065) the phase gets a share of the entered budget, so the
// entered budget it would take, and what the phase gets now: "Iron Ore to about 12,000/min
// (entered: 9,210/min; this phase gets 921/min of it with Miner Mk.1 at 100%)". "to at least" for
// an unconfirmed amount.
function draftShortfallWords(
  shortfall: Shortfall,
  snapshot: StoredStage,
  settings: DraftSettings,
  phase?: number,
): string {
  const entered = settings?.limits?.[shortfall.name];
  const mining = snapshot.mining;
  // A whole-machine draft amount the real fit did not confirm is a floor (#1091).
  const about = shortfall.atLeast ? 'at least' : 'about';
  const share = draftShare(shortfall, snapshot, settings, phase);
  if (!mining || entered === undefined || !(share > 0))
    return `${shortfall.name} to ${about} ${draftRate(shortfall.name, shortfall.needed)} (entered: ${draftRate(shortfall.name, shortfall.budget)})`;
  const need = draftRate(shortfall.name, draftEnteredNeed(shortfall, snapshot, settings, phase));
  // An entered budget of none (#1185): the share of it the phase would get.
  const gets =
    shortfall.budget > 0
      ? `this phase gets ${draftRate(shortfall.name, shortfall.budget)} of it`
      : `this phase would get ${num(Math.round(share * 1000) / 10)}% of it`;
  return `${shortfall.name} to ${about} ${need} (entered: ${draftRate(shortfall.name, entered)}; ${gets} with ${minerWords(mining.miner)})`;
}

// Whether the plan's recipe setting already allows a hard-drive alternate (recipePool in
// planner/recipes.ts): every one under 'all', the picked ones under 'custom', the owned ones and,
// with pure ingots, the pure ingot ones under any.
const draftAllows = (settings: DraftSettings, alternate: CatalogRecipe): boolean =>
  settings?.recipes === 'all' ||
  (settings?.recipes === 'custom' && !!settings.alternateRecipes?.includes(alternate.id)) ||
  !!settings?.ownedAlternates?.includes(alternate.id) ||
  (!!settings?.pureIngots && !!alternate.pure);
// The four metal ingots pure ingots take over from Phase 3 (recipePool's `metals`).
const DRAFT_METALS = ['Iron Ingot', 'Copper Ingot', 'Caterium Ingot', 'Aluminum Ingot'];

// Hard-drive alternates the plan does not allow yet that make the main product of a draft line
// mining a short resource from raw resources alone, with less of that resource per item: the line's
// own rate of it per item against the alternate's, at the recipe part cost (#1161). Each with what
// that line would draw less if it used the alternate throughout ("up to"), best first by the
// share of the need it saves.
function draftAlternates(
  snapshot: StoredStage,
  settings: DraftSettings,
  phase: number,
  alternates: readonly CatalogRecipe[],
  needs: DraftNeed[],
): { name: string; resource: string; saving: number }[] {
  const cost = settings?.recipeCost ?? 1;
  const best = new Map<string, { name: string; resource: string; saving: number; share: number }>();
  const used = new Set((snapshot.rows || []).map(row => recipeIdOf(row)));
  for (const need of needs) {
    if (need.name === 'Water') continue;
    const lines = (snapshot.rows || []).filter(
      (row: CalcRow) => (row.inputs?.[need.name] ?? 0) > 0 && row.power >= 0,
    );
    for (const row of lines) {
      const product = Object.keys(row.outputs || {})[0];
      const made = product ? (row.outputs[product] ?? 0) : 0;
      if (!product || !(made > 0)) continue;
      const perItem = row.inputs[need.name]! / made;
      for (const alternate of alternates) {
        const output = alternate.outputs[product] ?? 0;
        if (
          alternate.mam ||
          alternate.milestone ||
          alternate.phase > phase ||
          !(output > 0) ||
          used.has(alternate.id) ||
          draftAllows(settings, alternate) ||
          (settings?.pureIngots &&
            phase >= 3 &&
            DRAFT_METALS.includes(product) &&
            !alternate.pure) ||
          !Object.keys(alternate.inputs).every(item => rawResources.includes(item))
        )
          continue;
        const saving = (perItem - ((alternate.inputs[need.name] ?? 0) * cost) / output) * made;
        const share = saving / need.needed;
        if (share < DRAFT_NOTICEABLE / 5 || saving < 1) continue;
        const known = best.get(alternate.id);
        if (!known || known.share < share)
          best.set(alternate.id, { name: alternate.name, resource: need.name, saving, share });
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name))
    .slice(0, DRAFT_ALTERNATES);
}

// The line where one amplified machine saves most of a short resource, by share of the need: the
// build plan's somersloop ranking (app/sloop-payoff.ts, #1215) read on the draft's own lines.
function draftAmplified(snapshot: StoredStage, settings: DraftSettings, needs: DraftNeed[]) {
  const rows = (snapshot.rows || []).filter(takesSloops);
  if (!rows.length) return null;
  const costs = sloopUpstream(snapshot, settings ?? {});
  let found: { name: string; sloops: number; resource: string; saving: number } | null = null,
    share = 0;
  for (const row of rows) {
    const entry = sloopPayoffOf(row, costs, settings?.powerFactor ?? 1);
    for (const need of needs) {
      if (need.name === 'Water') continue;
      const saving = entry.raw.find(([item]) => item === need.name)?.[1] ?? 0;
      if (saving >= 1 && saving / need.needed > share) {
        share = saving / need.needed;
        found = { name: row.name, sloops: entry.sloops, resource: need.name, saving };
      }
    }
  }
  return found;
}

// The belt cap's lever (#1232): only with mining per phase, a belt cap that lowered this phase's
// belt, and a short resource mined onto belts (not Water, nor the fluids from oil nodes and wells).
function beltCapLever(
  snapshot: StoredStage,
  settings: DraftSettings,
  phase: number | undefined,
  shortfalls: Shortfall[],
): DraftLever | null {
  const mining = snapshot.mining;
  if (!mining || phase === undefined || !beltCapMark(settings?.beltCap)) return null;
  const free = phaseBelt(phase, settings?.ownedBelt);
  if (!(free.cap > mining.belt.cap)) return null;
  if (!shortfalls.some(shortfall => !DRAFT_FLUIDS.includes(shortfall.name))) return null;
  return {
    id: 'beltCap',
    text: `Raise or clear the belt cap (Goals): this phase taps its nodes on ${mining.belt.mark} belts (${num(mining.belt.cap)}/min), where ${free.mark} belts (${num(free.cap)}/min) would let each node give more.`,
    step: 3,
    label: 'Change the belt cap in Edit settings →',
  };
}

// The caps per phase's lever (#1221, #1020): for a draft whose plan needs more than a cap
// (`capShortfalls`), what the plan needs without it against each cap, on step 3 where they are.
// Null without one.
function phaseCapLever(snapshot: StoredStage): DraftLever | null {
  const over = snapshot.capShortfalls || [];
  if (!over.length) return null;
  const caps = over.length > 1 ? 'caps' : 'cap';
  const needs = over.map(
    ({ name, needed, cap }) =>
      `${phaseCapAmount(name, needed)} (the cap is ${phaseCapAmount(name, cap)})`,
  );
  return {
    id: 'phaseCap',
    text: `Raise the ${caps} per phase (Goals): without ${over.length > 1 ? 'them' : 'it'}, this phase's plan needs ${listNames(needs)}.`,
    step: 3,
    label: 'Change the caps in Edit settings →',
  };
}

// The advice for infeasible phase `snapshot` under `settings` (see the header). Every lever needs
// the draft to have measured something: an older snapshot, a stopped search or recipes that cannot
// make the goal at all get none, and their reason says why.
export function draftAdvice(
  snapshot: StoredStage,
  settings: DraftSettings,
  { phase, alternates = [] }: DraftAdviceContext = {},
): DraftAdvice {
  const needs = draftNeeds(snapshot, settings, phase);
  const levers: DraftLever[] = [];
  const shortfalls = snapshot.shortfalls || [];
  // A budget only helps where the map has more to give.
  const raisable = shortfalls.filter(
    shortfall => !needs.find(need => need.name === shortfall.name)?.overMap,
  );
  if (raisable.length)
    levers.push({
      id: 'budget',
      text: `Raise the short budget${raisable.length > 1 ? 's' : ''} (Resources): ${raisable.map(shortfall => draftShortfallWords(shortfall, snapshot, settings, phase)).join('; ')}.`,
      step: 4,
      label: 'Change budgets in Edit settings →',
    });
  // A cap per phase (#1221) the plan needs more than: raise it (#1020).
  const overCap = phaseCapLever(snapshot);
  if (overCap) levers.push(overCap);
  // A draft about the caps alone words its other levers by them, not by budgets.
  const capOnly = !!overCap && !shortfalls.length;
  const capWord = (snapshot.capShortfalls?.length ?? 0) > 1 ? 'caps' : 'cap';
  // A belt cap (#1232) that holds this phase's nodes to a worse belt than its milestones (or a belt
  // the player has) give, while a mined resource that rides belts is short: a better belt lets
  // each node give more. Read from the stored stage, so it names the belt the plan used.
  const capped = beltCapLever(snapshot, settings, phase, shortfalls);
  if (capped) levers.push(capped);
  // A cap on hard drives (#1233) that leaves this phase without alternates it fits with: the
  // planner records it on the draft of a phase that fits without the cap.
  if (snapshot.driveCap)
    levers.push({
      id: 'driveCap',
      text: `Raise or clear the cap on hard drives (Goals): the plan may count on ${driveCapWords(snapshot.driveCap.cap)} over all its phases, and without the cap this phase fits.`,
      step: 3,
      label: 'Change the cap on hard drives in Edit settings →',
    });
  if (snapshot.wholeMachinesOnly)
    levers.push({
      id: 'whole',
      text: capOnly
        ? `Keep the ${capWord} instead: untick “Whole machines” (Goals). Exact clocks keep within ${capWord === 'caps' ? 'them' : 'it'}, with one adjustable machine per production line.`
        : 'Keep these budgets instead: untick “Whole machines” (Goals). Exact clocks fit, with one adjustable machine per production line.',
      step: 3,
      label: 'Change whole machines in Edit settings →',
    });
  if (snapshot.minHours) {
    const timed = settings?.goal === 'timed';
    // The planner measures a cap draft's hours in the model's terms, so "may" (capReason).
    const fits = capOnly
      ? `this phase may fit within the ${capWord} from there`
      : 'this phase fits the current budgets from there';
    levers.push({
      id: 'time',
      text: timed
        ? `More time: raise “Hours per phase” (Goals) to at least ${num(snapshot.minHours)} h; ${fits}.`
        : `More time: switch the goal (Goals) to “Target completion time” with at least ${num(snapshot.minHours)} hours per phase; ${fits}.`,
      step: 3,
      label: 'Change the goal in Edit settings →',
      // Hours per phase apply to every phase only when the target time is not the final phase's.
      ...(timed && settings?.phaseTime !== 'final' ? { hours: snapshot.minHours } : {}),
    });
  } else if (shortfalls.length && !snapshot.wholeMachinesOnly) {
    // Storage fed from surplus is not a demand of a whole-machine draft's solve (#1100), so
    // lowering it does not help; a draft stored before that, whose solve held storage, names it.
    const fromSurplus =
      settings?.wholeMachines &&
      settings.storageFromSurplus === true &&
      !Object.values(snapshot.storage ?? {}).some(rate => rate > 0);
    const demands = `${fromSurplus ? '' : 'the protected storage refill rate, '}drone-fuel supply or extra Singularity Cells (Preferences)`;
    levers.push({
      id: 'demands',
      text:
        settings?.goal === 'maximum'
          ? `Lower ${demands}.`
          : `More time alone will not fit: lower ${demands}${settings?.roundRates ? ', or untick delivery-rate rounding (Goals)' : ''}.`,
      step: 2,
      label: 'Change demands in Edit settings →',
    });
  }
  // A phase that fits until what its buildings cost to build is counted (#1229, the draft's
  // `buildCost`): the setting is on step 1.
  if (snapshot.buildCost)
    levers.push({
      id: 'buildCost',
      text: 'Stop counting what buildings cost to build: untick “Count what buildings cost to build” (Game settings). This phase fits its budgets as planned without it.',
      step: 1,
      label: 'Change build costs in Edit settings →',
    });
  if (!shortfalls.length) return { needs, levers };
  const mined = needs.filter(need => need.name !== 'Water');
  // Named alternates where the draft's lines show some, else the general advice under Standard
  // recipes; none under 'all', which allows every one, nor where the cap on hard drives left this
  // phase without the alternates it fits with (#1233: its own lever says so).
  const found =
    phase !== undefined && settings?.recipes !== 'all' && !snapshot.driveCap
      ? draftAlternates(snapshot, settings, phase, alternates, mined)
      : [];
  if (found.length || (settings?.recipes === 'standard' && !snapshot.driveCap))
    levers.push({
      id: 'alternates',
      text: found.length
        ? `Alternates that use less: ${listNames(found.map(entry => `${entry.name} (up to ${draftRateOf(entry.resource, Math.round(entry.saving))} less)`))}. Allow them under “Recipe access” (Preferences).`
        : 'Allow alternate recipes (Preferences) to cut raw resource use.',
      step: 2,
      label: 'Change recipes in Edit settings →',
    });
  if (phase !== undefined && phase >= AMPLIFIER_PHASE && mined.length) {
    const line = draftAmplified(snapshot, settings, mined);
    if (line) {
      const saves = `an amplified ${line.name} machine (${line.sloops} somersloop${line.sloops === 1 ? '' : 's'}) needs about ${draftRateOf(line.resource, Math.round(line.saving))} less`;
      levers.push({
        id: 'amplify',
        text:
          (settings?.amplifySloops ?? 0) > 0
            ? `Production Amplifiers: the amounts above are before amplification, and more “Somersloops for production amplification” (Preferences) cut them further: ${saves}.`
            : `Production Amplifiers: ${saves}. Give the plan “Somersloops for production amplification” (Preferences); machines take them after the MAM research ${AMPLIFIER_RESEARCH}.`,
        step: 2,
        label: 'Change somersloops in Edit settings →',
      });
    }
  }
  // The Converter's ore conversions are planned in Phase 5 only (draftStage's `conversion`).
  if (
    settings?.sam === 'avoid' &&
    (phase === undefined || phase === 5) &&
    mined.some(need => need.name !== 'SAM')
  )
    levers.push({
      id: 'sam',
      text: 'Allow SAM resource conversion (Preferences) to turn plentiful resources into the short ones.',
      step: 2,
      label: 'Change SAM conversion in Edit settings →',
    });
  // Nuclear Power Plants come with a nuclear goal, from Phase 4 (generators() in planner/recipes.ts).
  const burned = mined.filter(
    need =>
      need.name !== 'Uranium' && need.power >= DRAFT_NOTICEABLE * need.needed && need.power >= 1,
  );
  const uranium = settings ? mapSupply(settings, 'Uranium') : null;
  if (
    burned.length &&
    phase !== undefined &&
    phase >= 4 &&
    settings?.nuclear === 'none' &&
    (uranium === null || uranium.total > 0)
  )
    levers.push({
      id: 'nuclear',
      text: `Nuclear power: this phase burns ${listNames(burned.map(need => `about ${draftRateOf(need.name, Math.round(need.power))}`))} for power. With a “Nuclear goal” (Preferences), Nuclear Power Plants make ${powerWords(2500)} each from Uranium instead.`,
      step: 2,
      label: 'Change the nuclear goal in Edit settings →',
    });
  return { needs, levers };
}
