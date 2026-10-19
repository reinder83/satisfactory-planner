// Grown production lines (#1174, slice 1 of #1172): a line ticked as built that a recalculation
// (in place, or into a new profile carried from it) grew to more machines keeps the machines that
// stand (`builtMachines` in the progress state, version 18, set by carryLines in
// public/state/carry.ts). Until its step is ticked again, the step and the line's card say how
// many stand, how many the plan needs and how many to add, with the extra input the added
// machines take, and the build status counts the built part. Everything here reads the stored
// plan and the saved state: nothing is ticked, stored or recalculated. No session imports.
import { builtSoAdd, formatNumber } from '../progression.ts';
import type { StepTable } from '../step-table.ts';
import { listNames } from '../wording.ts';
import type { CalcRow } from '../types/index.ts';

// A grown line's machines: those that stand, those the plan needs and those to add.
export interface BuiltLine {
  built: number;
  needed: number;
  add: number;
}

// The machines that stand on `row` in stage `stageKey` ('1'-'5'), from `builtMachines`: only
// while its step is not ticked (ticked, all of them stand) and the plan still needs more than
// stand (a count at or above the plan's is no longer a grown line, #1175). null otherwise.
export function builtLine(
  builtMachines: Readonly<Record<string, number>> | undefined,
  checks: Readonly<Record<string, boolean>>,
  stageKey: string,
  row: Pick<CalcRow, 'id' | 'machines'>,
): BuiltLine | null {
  const key = 'calc-' + stageKey + '-' + row.id;
  const built = builtMachines?.[key] ?? 0;
  if (checks[key] || !(built >= 1) || !(built < row.machines)) return null;
  return { built, needed: row.machines, add: row.machines - built };
}

// The share of the line its built machines make: those machines at 100% against the line's
// machine-equivalents (the new last one is the adjustable one), at most 1. The build status runs
// the line at this share until its step is ticked, as it runs a line carried from the phase
// before (carriedShare in handover.ts).
export function builtShare(line: BuiltLine, row: Pick<CalcRow, 'equivalent'>): number {
  return row.equivalent > 0 ? Math.min(1, line.built / row.equivalent) : 1;
}

// What each input of the line takes with only its built machines at 100%, and in all: the input
// rates of the plan's row, split by the same share.
function inputParts(line: BuiltLine, row: Pick<CalcRow, 'inputs' | 'equivalent'>) {
  const share = builtShare(line, row);
  return Object.entries(row.inputs || {})
    .filter(([, rate]) => rate > 0)
    .map(([item, rate]) => ({ item, built: rate * share, needed: rate, add: rate * (1 - share) }));
}

// A machine's name for a count: "Refinery", "Refineries" (the y→ie swap of machinesLabel in
// flow.ts pluralises Refinery and Foundry).
export const machineWord = (count: number, machine: string): string =>
  count === 1 ? machine : machine.replace(/y$/, 'ie') + 's';

// The note under the step's title and on the line's card: "5 of 6 built".
export const builtNote = (line: BuiltLine): string =>
  `${formatNumber(line.built)} of ${formatNumber(line.needed)} built`;

// The step's opening sentence: "5 Refineries built, so add 1, which takes 10 m³/min more Heavy
// Oil Residue. Tick this step once all 6 stand." `rate` words an item's rate ("10 m³/min").
export function builtIntro(
  line: BuiltLine,
  row: Pick<CalcRow, 'machine' | 'inputs' | 'equivalent'>,
  rate: (item: string, value: number) => string,
): string {
  const extra = inputParts(line, row).map(part => `${rate(part.item, part.add)} more ${part.item}`);
  const takes = extra.length
    ? `, which ${line.add === 1 ? 'takes' : 'take'} ${listNames(extra)}`
    : '';
  return (
    builtSoAdd(line.built, line.add, machineWord(line.built, row.machine)) +
    takes +
    `. Tick this step once all ${formatNumber(line.needed)} stand.`
  );
}

// The step's table (#1136's style): the machines and each input, built, needed and to add.
// `after` is the rest of the step's text (its machines, inputs and outputs).
export function builtTable(
  line: BuiltLine,
  row: Pick<CalcRow, 'machine' | 'inputs' | 'equivalent'>,
  rate: (item: string, value: number) => string,
  title: string,
  after: string,
): StepTable {
  return {
    intro: builtIntro(line, row, rate),
    columns: ['Machines and inputs', 'Built', 'Needed', 'To add'],
    rows: [
      [
        machineWord(line.needed, row.machine),
        formatNumber(line.built),
        formatNumber(line.needed),
        formatNumber(line.add),
      ],
      ...inputParts(line, row).map(part => [
        part.item,
        rate(part.item, part.built),
        rate(part.item, part.needed),
        rate(part.item, part.add),
      ]),
    ],
    after,
    caption: `${title}: machines built and to add`,
  };
}
