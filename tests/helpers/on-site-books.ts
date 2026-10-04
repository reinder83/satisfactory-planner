// What the property checks of items made on site (#984, #904) share: a seeded random generator,
// and the check that each group's own lines match the Logistics books (itemBooks) right after a
// recalculation with the groups unchanged.
import { DATA } from '../../planner.ts';
import { itemBooks } from '../../public/app/group-links.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../../public/types/index.ts';

// A small seeded generator, so a failure can be replayed.
export function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  return { next, pick };
}

export const rowsOf = (stage: StoredStage): CalcRow[] => stage.rows || [];

// Whether an item balances exactly in the plan, rather than overflowing to the sink: a fluid, a
// radioactive item, waste, or anything the sink does not take (exactBalance in the planner).
export const exact = (item: string) =>
  !!DATA.items[item]?.fluid ||
  !!DATA.items[item]?.radioactive ||
  item.endsWith('Waste') ||
  !((DATA.items[item]?.sink ?? 0) > 0);

// What is wrong with the groups' own lines in a phase right after the recalculation, as
// messages. For each item a group marks and makes on its own lines (ItemBooks.local):
// - the lines make at least what the books give the group (`asked`), less 1e-6 × max(1, asked);
// - they make less than that plus, for each of the group's own lines of the item, its rounding:
//   one machine's output on a whole-machine line (equivalent within 1e-6 of its machines), none on
//   a fractional one, and all of its output on a line that makes another item too, which may be
//   what sizes it (a Rubber line making the group's Heavy Oil Residue, a Plastic line making the
//   plan's Heavy Oil Residue); plus the same 1e-6;
// - nothing is offered (ItemBooks.offered, above 1e-6 × max(1, rate)): the sink takes every
//   group's excess, within the plan's surplus.
// Left out, and counted in `left`: an item that balances exactly (a fluid such as Heavy Oil
// Residue), whose lines the planner still sizes by the shares worked out from the plan being
// recalculated, as before #984 (followedParts in planner/on-site.ts), and a group's item that
// `skip` names.
export function lineProblems(
  stage: StoredStage,
  groups: FactoryGroups,
  label: string,
  left: { count: number },
  skip: (group: string, item: string) => boolean = () => false,
): string[] {
  const problems: string[] = [];
  const tolerance = (rate: number) => 1e-6 * Math.max(1, rate);
  const books = itemBooks(stage, groups);
  const ownLines = (group: string, item: string) =>
    rowsOf(stage).filter(line => line.onSite?.group === group && line.outputs[item]);
  for (const [item, lines] of Object.entries(books.local))
    for (const [group, { made, asked }] of lines) {
      if (exact(item) || skip(group, item)) {
        left.count++;
        continue;
      }
      const rounding = (line: CalcRow) =>
        Object.keys(line.outputs).length > 1
          ? line.outputs[item]!
          : Math.abs(line.equivalent - line.machines) < 1e-6
            ? line.outputs[item]! / line.machines
            : 0;
      const slack = ownLines(group, item).reduce((total, line) => total + rounding(line), 0);
      if (made < asked - tolerance(asked))
        problems.push(`${label}: ${group}'s lines make ${made} ${item} of the ${asked} it asks`);
      if (made >= asked + slack + tolerance(asked))
        problems.push(`${label}: ${group}'s lines make ${made} ${item} for ${asked} (${slack})`);
    }
  for (const [item, places] of Object.entries(books.offered))
    for (const [group, rate] of places)
      if (rate > tolerance(rate) && !exact(item) && !skip(group, item))
        problems.push(`${label}: ${group} offers ${rate} ${item}`);
  return problems;
}
