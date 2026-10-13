// Why a line's output goes to the AWESOME Sink (#1063), for the caption under the sink in the
// factory dialog's flow (ui/detail/FlowDiagram.vue). "Whole-machine rounding surplus" used to
// caption every sink, also 480 Petroleum Coke/min that a line made only to use up Heavy Oil
// Residue: whole machines round a line up by less than one machine, so a sink that large has
// another cause. In order:
// - 'uses-up': the line takes a fluid that another line of the phase makes as a byproduct (Heavy
//   Oil Residue, from Plastic or Rubber). A fluid balances exactly and has no sink, so the plan
//   runs this line to use it up, and what it makes is left over from that (Petroleum Coke, or
//   Coated Cable beyond what the plan uses);
// - 'alongside', for a byproduct: the line runs for its main product, which the phase uses
//   (Compacted Coal from Nitro Rocket Fuel names Rocket Fuel);
// - 'rounding': the plan runs whole machines and the sink takes less than one machine's output of
//   each line making the item together, so rounding up can explain all of it;
// - 'alongside': the line runs for another of its outputs that the phase uses (Rubber beyond
//   what the plan uses, made alongside the Heavy Oil Residue it needs);
// - 'unused': none of these.
// burnNote, at the end of this file, says why the plan sinks spare Petroleum Coke or Compacted
// Coal rather than burning it, under a main power that builds no Coal Generators.
// It reads only its arguments: a stored plan's rows and settings, so it changes nothing that is
// stored, and a plan keeps its numbers until the user recalculates.
import { rawResources } from '../preferences.ts';
import type { CalcRow, MainPower, StoredSettings, StoredStage } from '../types/index.ts';

export type SinkCause =
  | { kind: 'rounding' }
  | { kind: 'uses-up'; item: string }
  | { kind: 'alongside'; item: string }
  | { kind: 'unused' };

// What the stage's lines and demands take of `item` per minute: the rows' inputs, protected
// storage, deliveries, drone and vehicle fuel.
function phaseUse(stage: StoredStage, item: string): number {
  const rows = (stage.rows || []).reduce((total, row) => total + (row.inputs?.[item] || 0), 0);
  return (
    rows +
    (stage.storage?.[item] || 0) +
    (stage.delivery?.[item]?.rate || 0) +
    (stage.drone?.[item] || 0) +
    (stage.transport?.[item] || 0)
  );
}

// A row's output of `item` per machine at 100%.
const perMachine = (row: CalcRow, item: string) =>
  row.equivalent > 0 ? (row.outputs?.[item] || 0) / row.equivalent : 0;

// A fluid input of `row` that another line of the stage makes as a byproduct (any output but its
// first, its main product), or undefined.
function fluidUsedUp(
  row: CalcRow,
  stage: StoredStage,
  fluid: (item: string) => boolean,
): string | undefined {
  return Object.keys(row.inputs || {}).find(
    input =>
      fluid(input) &&
      !rawResources.includes(input) &&
      (stage.rows || []).some(
        other =>
          other !== row &&
          (other.outputs?.[input] || 0) > 0 &&
          Object.keys(other.outputs)[0] !== input,
      ),
  );
}

// Why `row`'s `item` goes to the sink at `sunk` per minute in `stage` (see the top of this file).
// `wholeMachines`: the plan's settings ask for whole machines. `fluid` says whether an item
// travels by pipe (FLUIDS in flow.ts).
export function sinkCause(
  row: CalcRow,
  item: string,
  sunk: number,
  stage: StoredStage,
  wholeMachines: boolean,
  fluid: (item: string) => boolean,
): SinkCause {
  const usedUp = fluidUsedUp(row, stage, fluid);
  if (usedUp) return { kind: 'uses-up', item: usedUp };
  const used = Object.keys(row.outputs || {}).filter(
    other => other !== item && phaseUse(stage, other) > 1e-6,
  );
  const main = Object.keys(row.outputs || {})[0];
  if (main !== item && main !== undefined && used.includes(main))
    return { kind: 'alongside', item: main };
  const roundingRoom = (stage.rows || []).reduce(
    (total, maker) => total + perMachine(maker, item),
    0,
  );
  if (wholeMachines && sunk < roundingRoom - 1e-6) return { kind: 'rounding' };
  return used[0] ? { kind: 'alongside', item: used[0] } : { kind: 'unused' };
}

// What exact clocks would do to a line's overflow, in its "Exact clocks for this line" note
// (ui/detail/ExactClockChoice.vue): undefined where rounding to whole machines explains the
// overflow, which exact clocks remove; otherwise the sentence that says why they would not.
export function exactClocksKeep(cause: SinkCause): string | undefined {
  const only = 'they only underclock the last machine to the exact remainder.';
  switch (cause.kind) {
    case 'rounding':
      return undefined;
    case 'uses-up':
      return `It is left over from using up ${cause.item}, so exact clocks would not remove it: ${only}`;
    case 'alongside':
      return `It is made alongside ${cause.item}, which this phase uses, so exact clocks would not remove it: ${only}`;
    case 'unused':
      return `That is more than rounding to whole machines explains, so exact clocks would remove at most part of it: ${only}`;
  }
}

// The caption under the sink for a cause (FlowDiagram.vue).
export function sinkCaption(cause: SinkCause): string {
  switch (cause.kind) {
    case 'rounding':
      return 'whole-machine rounding surplus';
    case 'uses-up':
      return `left over from using up ${cause.item}`;
    case 'alongside':
      return `made alongside ${cause.item}, which this phase uses`;
    case 'unused':
      return 'more than this phase uses';
  }
}

// The Coal Generator fuels a line may make beyond what its phase uses (#1055): Petroleum Coke
// from Heavy Oil Residue, Compacted Coal beside Rocket Fuel.
export const COAL_GENERATOR_FUELS: readonly string[] = ['Petroleum Coke', 'Compacted Coal'];

// The main power a phase runs on, as the burn note names it (burnNote), for a choice whose
// generators burn no Coal Generator fuel in that phase: what generators() in planner/recipes.ts
// keeps for it (Turbofuel before Phase 4 for the rocket and nuclear choices). Undefined for auto
// and coal, which may build Coal Generators, and before Phase 3, which offers every generator.
export function mainPowerWords(
  mainPower: MainPower | undefined,
  phase: number,
): string | undefined {
  if (phase < 3) return undefined;
  const late = phase >= 4;
  switch (mainPower) {
    case 'fuel':
      return 'fuel';
    case 'turbofuel':
      return 'turbofuel';
    case 'rocket':
      return late ? 'rocket fuel' : 'turbofuel';
    case 'nuclear':
      return late ? 'nuclear' : 'turbofuel';
    case 'turbofuel-nuclear':
      return late ? 'turbofuel and nuclear' : 'turbofuel';
    case 'rocket-nuclear':
      return late ? 'rocket fuel and nuclear' : 'turbofuel';
    default:
      return undefined;
  }
}

// Why the plan sinks a Coal Generator fuel rather than burning it (#1063, the owner's decision):
// under a main power that builds no Coal Generators, burning the spare coke would take more
// machines (generators and their Water Extractors) than it saves of the main power's chain, so
// the plan sinks it, and coal power is the choice that burns it (#1055). Undefined for any other
// item, for a phase that already has a generator line burning it, for a sink that rounding to
// whole machines explains and under a main power that may burn it. `sunk` is what `row` sends to
// the sink of `item` per minute; `phase` is the stage's phase (5 for post-game). Words only: it
// reads the stored plan and changes nothing.
export function burnNote(
  row: CalcRow,
  item: string,
  sunk: number,
  stage: StoredStage,
  settings: Pick<StoredSettings, 'mainPower' | 'wholeMachines'> | undefined,
  phase: number,
  fluid: (item: string) => boolean,
): string | undefined {
  if (!COAL_GENERATOR_FUELS.includes(item) || !(sunk > 0)) return undefined;
  const words = mainPowerWords(settings?.mainPower, phase);
  if (!words) return undefined;
  const burnt = (stage.rows || []).some(
    other => (other.generationMW || 0) > 0 && (other.inputs?.[item] || 0) > 0,
  );
  if (burnt) return undefined;
  const cause = sinkCause(row, item, sunk, stage, !!settings?.wholeMachines, fluid);
  if (cause.kind === 'rounding') return undefined;
  return `The plan sinks its spare ${item}: burning it in Coal Generators would need more machines than it saves in the ${words} power chain. With coal power, the plan burns it in Coal Generators instead.`;
}
