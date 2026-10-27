// Power Shards on production lines (#1239): the clocks a line's Power Shard pin offers and the words
// for a clock a phase could not keep (LineClockReason, planner/clocks.ts), which the planner's
// warning, ADA and the production line dialog share, as somersloops.ts does for somersloop pins.
import { extractorShards } from './preferences.ts';
import { localeNumber } from './wording.ts';
import type { CalcRow, LineClockReason } from './types/index.ts';

// The MAM research that lets machines take Power Shards (OVERCLOCK_RESEARCH in preferences).
export const SHARD_RESEARCH = 'Overclock Production';
// The clocks a line's pin offers: one, two or three Power Shards in every machine. A pin of N
// shards is the clock 100 + 50 × N (slice 1's call 4 in #1239).
export const SHARD_PIN_CLOCKS = [150, 200, 250] as const;
// The Power Shards one machine at `clock` % holds: 1 up to 150%, 2 up to 200%, 3 up to 250%.
export const shardsPerMachine = (clock: number): number => extractorShards(clock);
// The Power Shards an overclocked row's machines need in the game: each the shards for the line's
// clock, the last one those for its own clock (lastClock), fewer when an exact plan underclocks it
// to the remainder (a 250% line of 3 machines whose last runs at 57.75% needs 3 + 3 + 0 = 6). The
// row's `shards` counts the last one at the full clock too, which the planner's shard budget
// checks (a later re-solve may run it at full clock); the pages show this count. 0 at 100%.
export const gameShards = (row: Pick<CalcRow, 'clock' | 'machines' | 'lastClock'>): number =>
  row.clock && row.machines > 0
    ? (row.machines - 1) * shardsPerMachine(row.clock) + shardsPerMachine(row.lastClock)
    : 0;
// "1 Power Shard", "9 Power Shards".
export const powerShardWords = (shards: number): string =>
  `${localeNumber(shards)} Power Shard${shards === 1 ? '' : 's'}`;

// Why a phase could not keep a line's clock, as a clause: "machines take Power Shards only once …".
// `budget` is the plan's settings.lineShardBudget.
export function clockReasonWords(reason: LineClockReason, budget?: number): string {
  if (reason === 'research')
    return `machines take Power Shards only once the MAM research ${SHARD_RESEARCH} is done, which a Phase 1 plan counts on only when you can overclock`;
  if (reason === 'budget')
    return `the phase’s overclocked production lines would hold more than the ${powerShardWords(budget ?? 0)} this plan allows them`;
  if (reason === 'unavailable') return 'the recipe is not available in this phase of the plan';
  return 'no plan of the phase fits with it, so the planner ran the line at 100%';
}
// What changes a clock a phase could not keep, after the reason. `inDialog`: the note in the
// production line's dialog itself, whose pin is right above it, says "here".
export function clockRemedyWords(reason: LineClockReason, inDialog = false): string {
  if (reason === 'research') {
    const tick =
      'Tick “I can overclock” on step 4 of Edit settings (under “Each phase’s budgets follow the miners and belts it can build”)';
    return inDialog
      ? `${tick}, or clear the pin here.`
      : `${tick}, or clear the pin in the production line’s dialog.`;
  }
  if (reason === 'budget')
    return inDialog
      ? 'Lower or clear this pin here, or the phase’s other pins in their production lines’ dialogs.'
      : 'Lower or clear the pins in the production lines’ dialogs.';
  return inDialog
    ? 'Change or clear the pin here.'
    : 'Change or clear the pin in the production line’s dialog.';
}
