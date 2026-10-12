// A build-plan step's body as a table (#1136): structured data next to the step's plain `body`,
// which stays as it was for "Find a step…", copying and stored step edits. The build plan draws
// the table in place of the body (ui/plan/StepTable.vue): `intro` above it, one row per item (its
// first cell names the item and heads the row), an optional `total` row, and `after` under it. On a
// phone each row stacks into one block, each cell under its column's name.
//
// Nothing here is stored: a step's table is worked out from the plan each time, as its body is,
// so a plan stored before it shows the table too, and a step whose body the user edited shows the
// edited text instead (withEditedWording in app/tasks.ts).
export interface StepTable {
  intro: string;
  // The column names, the first naming the rows' items.
  columns: string[];
  rows: string[][];
  total?: string[];
  after?: string;
  // The table's accessible name, for its <caption>.
  caption: string;
}

// A step's body as a list (#1136, the audit): where a table does not fit, one line per item, such
// as a production line's byproduct advice, one paragraph per byproduct or input. The build plan
// draws it in place of the body (ui/plan/StepList.vue): `intro` above it, the items as a list and
// `after` under it. Worked out from the plan like a table, never stored, and replaced by an edited
// body in the same way.
export interface StepList {
  intro: string;
  items: string[];
  after?: string;
  // The list's accessible name, for its aria-label.
  label: string;
}

// Every word a table shows, column names included, for the step search: a step matches what its
// table says even where its body words it differently ("Machines", "Shards"). '' without one.
export const tableText = (table: StepTable | undefined): string =>
  table
    ? [table.intro, table.columns, ...table.rows, table.total ?? [], table.after ?? '']
        .flat()
        .join(' ')
    : '';

// Every word a list shows, for the step search. '' without one.
export const listText = (list: StepList | undefined): string =>
  list ? [list.intro, ...list.items, list.after ?? ''].join(' ') : '';
