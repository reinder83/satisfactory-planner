// Grown production lines (#1174, slice 1 of #1172): a line ticked as built that a recalculation
// (in place, or into a new profile carried from it) grew to more machines keeps the machines that
// stand (`builtMachines` in the progress state, version 19, set by carryLines in
// public/state/carry.ts). Until its step is ticked again, the step and the line's card say how
// many stand, how many the plan needs and how many to add, with the extra input the added
// machines take, and the build status counts the built part. Everything here reads the stored
// plan and the saved state: nothing is ticked, stored or recalculated. No session imports.
// Shrunk, switched and removed lines (#1175) follow at the end.
import { builtSoAdd, formatNumber } from '../progression.ts';
import {
  calcKeyParts,
  lineFacts,
  builtLineName,
  sameProduct,
  stageRowsOf,
  successorOf,
  type RecipeBook,
} from '../state.ts';
import type { StepTable } from '../step-table.ts';
import { listNames } from '../wording.ts';
import type { CalcRow, StoredCalculatedPlan } from '../types/index.ts';

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

// Shrunk, switched and removed lines (#1175, slice 2 of #1172). A carry keeps the machines that
// stand on a built line the new plan changed (carryLines and carryFormerLines in
// public/state/carry.ts, matched by public/state/built-match.ts); these say what to do with them.
// They read the stored plan and the saved state: nothing is ticked, stored or recalculated.

// A machine count's word when the machine may not be known (a line no catalog names).
const builtMachinesWord = (count: number, machine: string): string =>
  machine ? machineWord(count, machine) : count === 1 ? 'machine' : 'machines';
const itThem = (count: number) => (count === 1 ? 'it' : 'them');

// A line with at least as many machines standing as it needs (shrunk, #1175): ticked with more
// than it needs, or not ticked with at least as many (the machines stand, the step is not ticked
// yet). null otherwise.
export interface SpareLine {
  built: number;
  needed: number;
  spare: number;
  ticked: boolean;
}
export function spareLine(
  builtMachines: Readonly<Record<string, number>> | undefined,
  checks: Readonly<Record<string, boolean>>,
  stageKey: string,
  row: Pick<CalcRow, 'id' | 'machines'>,
): SpareLine | null {
  const key = 'calc-' + stageKey + '-' + row.id;
  const built = builtMachines?.[key] ?? 0,
    ticked = !!checks[key];
  if (!(built >= 1) || built < row.machines || (ticked && built === row.machines)) return null;
  return { built, needed: row.machines, spare: built - row.machines, ticked };
}

// The step's opening sentence: "6 Refineries built, 5 needed: 1 is spare. Switch it off or
// dismantle it, or underclock all 6 to share the work." Never "build".
export function spareIntro(line: SpareLine, machine: string): string {
  const { built, needed, spare } = line;
  if (!spare)
    return `All ${formatNumber(needed)} ${builtMachinesWord(needed, machine)} this line needs are built. Tick this step once they run.`;
  return (
    `${formatNumber(built)} ${builtMachinesWord(built, machine)} built, ${formatNumber(needed)} needed: ` +
    `${formatNumber(spare)} ${spare === 1 ? 'is' : 'are'} spare. Switch ${itThem(spare)} off or ` +
    `dismantle ${itThem(spare)}, or underclock all ${formatNumber(built)} to share the work.` +
    (line.ticked ? '' : ` Tick this step once the ${formatNumber(needed)} needed run.`)
  );
}

// The note under the step's title, also while it is ticked: "6 built, 1 spare".
export const spareNote = (line: SpareLine): string =>
  line.spare
    ? `${formatNumber(line.built)} built, ${formatNumber(line.spare)} spare`
    : `${formatNumber(line.built)} of ${formatNumber(line.needed)} built`;

// The step's table (#1136's style): the machines built, needed and spare.
export function spareTable(
  line: SpareLine,
  machine: string,
  title: string,
  after: string,
): StepTable {
  return {
    intro: spareIntro(line, machine),
    columns: ['Machines', 'Built', 'Needed', 'Spare'],
    rows: [
      [
        builtMachinesWord(2, machine),
        formatNumber(line.built),
        formatNumber(line.needed),
        formatNumber(line.spare),
      ],
    ],
    after,
    caption: `${title}: machines built, needed and spare`,
  };
}

// A built line the plan no longer has, switched to a line of another recipe (its successor,
// built-match.ts): its machines, how many of them switch (same machine only, up to what the
// line still needs) and how many are left over.
export interface SwitchFrom {
  key: string;
  name: string;
  machine: string;
  built: number;
  switched: number;
  left: number;
  sameMachine: boolean;
}
// A line the built lines of other recipes switch to (#1175): the machines it needs, those that
// stand on it already (a grown line's), the lines it takes over and the machines to add.
export interface ChangedLine {
  needed: number;
  standing: number;
  from: SwitchFrom[];
  add: number;
}
// A built line the plan no longer has and nothing takes over: it can be dismantled or kept.
export interface FormerLine {
  key: string;
  name: string;
  machine: string;
  built: number;
}
export interface PhaseChanges {
  changed: Map<string, ChangedLine>;
  removed: FormerLine[];
}

// The built lines of phase `stageKey` that `plan` no longer has (keys of `builtMachines` that are
// no row of the phase), in key order: a ticked one is no longer needed; one not ticked switches to
// its successor while there is one not ticked, is done once every line making its product is
// ticked, and is no longer needed when no line of the phase makes it. `book` names a line no plan
// row does (the catalog's recipes).
export function builtLineChanges(
  builtMachines: Readonly<Record<string, number>> | undefined,
  checks: Readonly<Record<string, boolean>>,
  stageKey: string,
  plan: Pick<StoredCalculatedPlan, 'stages'>,
  book: RecipeBook | undefined,
): PhaseChanges {
  const rows = stageRowsOf(plan, stageKey),
    ids = new Set(rows.map(row => row.id)),
    taken = new Map<string, { row: CalcRow; lines: FormerLine[] }>(),
    removed: FormerLine[] = [];
  const entries = Object.entries(builtMachines || {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, built] of entries) {
    const parts = calcKeyParts(key);
    if (!parts || parts[0] !== stageKey || ids.has(parts[1]) || !(built >= 1)) continue;
    const rowId = parts[1],
      facts = lineFacts(rowId, [plan], book),
      line = { key, name: facts.name, machine: facts.machine, built };
    const next = checks[key] ? null : successorOf(facts, rowId, rows, checks, stageKey);
    if (next) {
      const entry = taken.get(next.id) ?? { row: next, lines: [] };
      entry.lines.push(line);
      taken.set(next.id, entry);
    } else if (checks[key] || !sameProduct(rows, facts.product, rowId).length) removed.push(line);
  }
  const changed = new Map<string, ChangedLine>();
  for (const [id, { row, lines }] of taken) {
    const own = builtMachines?.['calc-' + stageKey + '-' + id] ?? 0,
      standing = own >= 1 ? own : 0;
    let room = Math.max(0, row.machines - standing);
    const from = lines.map(line => {
      const sameMachine = !!line.machine && line.machine === row.machine,
        switched = sameMachine ? Math.min(line.built, room) : 0;
      room -= switched;
      return { ...line, switched, left: line.built - switched, sameMachine };
    });
    changed.set(id, { needed: row.machines, standing, from, add: room });
  }
  return { changed, removed };
}

// A switched line's step opens with what changes: "Switch 4 Constructors from Iron Plate to Cast
// Screw, and add 1. Tick this step once all 5 run Cast Screw." A line on another machine is
// replaced ("… the 4 Constructors built for Iron Plate can be dismantled or kept"), and machines
// a switch leaves over are spare.
export function changedIntro(line: ChangedLine, row: Pick<CalcRow, 'name' | 'machine'>): string {
  const sentences: string[] = [],
    { standing, add, needed } = line,
    name = builtLineName(row.name);
  if (standing)
    sentences.push(
      `${formatNumber(standing)} ${builtMachinesWord(standing, row.machine)} built for ${name}.`,
    );
  const switches = line.from
    .filter(from => from.switched > 0)
    .map(
      from =>
        `${formatNumber(from.switched)} ${builtMachinesWord(from.switched, from.machine)} from ${from.name}`,
    );
  if (switches.length)
    sentences.push(
      `Switch ${listNames(switches)} to ${name}` + (add ? `, and add ${formatNumber(add)}.` : '.'),
    );
  else if (add)
    sentences.push(
      standing
        ? `Add ${formatNumber(add)}.`
        : `Build ${formatNumber(add)} ${builtMachinesWord(add, row.machine)} for ${name}.`,
    );
  for (const from of line.from) {
    const what = `${formatNumber(from.left)} ${builtMachinesWord(from.left, from.machine)}`;
    if (!from.sameMachine)
      sentences.push(
        `${name} replaces ${from.name} on ${builtMachinesWord(2, row.machine)}: the ${what} built for ${from.name} can be dismantled or kept.`,
      );
    else if (from.left)
      sentences.push(
        `The other ${what} on ${from.name} ${from.left === 1 ? 'is' : 'are'} spare: switch ${itThem(from.left)} off or dismantle ${itThem(from.left)}.`,
      );
  }
  sentences.push(`Tick this step once all ${formatNumber(needed)} run ${name}.`);
  return sentences.join(' ');
}

// The note under a switched line's title and on its card: "4 to switch from Iron Plate, 1 to add".
export function changedNote(line: ChangedLine): string {
  const switched = line.from.reduce((total, from) => total + from.switched, 0),
    names = line.from.filter(from => from.switched > 0).map(from => from.name);
  const parts = [
    switched ? `${formatNumber(switched)} to switch from ${listNames(names)}` : '',
    line.add ? `${formatNumber(line.add)} to add` : '',
  ].filter(Boolean);
  return parts.join(', ') || `${formatNumber(line.needed)} to switch over`;
}

// The step's table (#1136's style): each line it takes over and the line itself, with the
// machines built, needed and what changes.
export function changedTable(
  line: ChangedLine,
  row: Pick<CalcRow, 'name' | 'machine'>,
  title: string,
  after: string,
): StepTable {
  const name = builtLineName(row.name);
  const change = (from: SwitchFrom) =>
    !from.sameMachine
      ? `dismantle or keep ${formatNumber(from.built)}`
      : [
          from.switched ? `switch ${formatNumber(from.switched)} to ${name}` : '',
          from.left ? `${formatNumber(from.left)} spare` : '',
        ]
          .filter(Boolean)
          .join(', ');
  return {
    intro: changedIntro(line, row),
    columns: ['Production line', 'Machines', 'Built', 'Needed', 'Change'],
    rows: [
      ...line.from.map(from => [
        from.name,
        builtMachinesWord(2, from.machine),
        formatNumber(from.built),
        '0',
        change(from),
      ]),
      [
        name,
        builtMachinesWord(2, row.machine),
        formatNumber(line.standing),
        formatNumber(line.needed),
        line.add ? `add ${formatNumber(line.add)}` : 'none to add',
      ],
    ],
    after,
    caption: `${title}: machines to switch and to add`,
  };
}

// The phase's note of built lines no longer needed (#1175, ui/plan/FormerLines.vue): what each
// was, its machines and that the plan needs none of them.
export function formerTable(lines: readonly FormerLine[], phaseName: string): StepTable {
  const one = lines.length === 1;
  return {
    intro:
      `${one ? 'This production line' : `These ${lines.length} production lines`} you built under an earlier plan ${one ? 'is' : 'are'} not in the plan for ${phaseName} any more. ` +
      `${one ? 'It' : 'They'} can be dismantled or kept: nothing in this plan counts on what ${one ? 'it makes' : 'they make'}.`,
    columns: ['Production line', 'Machines', 'Built', 'Needed'],
    rows: lines.map(line => [
      line.name,
      builtMachinesWord(2, line.machine),
      formatNumber(line.built),
      '0',
    ]),
    caption: `${phaseName}: production lines no longer needed`,
  };
}
