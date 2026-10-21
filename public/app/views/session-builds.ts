// "Today's session" (#1073, ui/pages/SessionPage.vue): the next open builds of the build plan, in
// the order it shows them, each with what it takes to build (step-materials.ts), its power, the raw
// resources it draws and whether what feeds it already runs; their materials together; and the
// short note for the game's To-Do list (todo-note.ts). It reads the stored plan and the ticks
// beside it, as the build plan does: nothing is stored or recalculated.
import { addMaterials, buildWords, partsWords, type BuildMaterials } from '../build-materials.ts';
import { itemRate } from '../flow.ts';
import { LINK_DUST } from '../group-order.ts';
import { calcStage, checked, phase, phaseLabel, stage } from '../session.ts';
import { idleStepNotes, planTasks, rowFactory, stepDone } from '../tasks.ts';
import { todoNote } from '../todo-note.ts';
import { power } from '../wizard/fields.ts';
import { lineLoad } from '../../power.ts';
import { currentCarry, stepRowName } from './calculated.ts';
import { rowMaterials, stepRow } from './step-materials.ts';
import type { CalcRow, StoredStage } from '../../types/index.ts';

// Whether the session's inputs are ready: every line feeding it runs, it waits only on builds
// before it in this session, or it waits on lines not marked running (or the open mining step).
export type SessionReadiness = 'ready' | 'after' | 'waiting';

// One build of the session, numbered from 1.
export interface SessionBuild {
  id: string;
  number: number;
  title: string;
  factory: string | null;
  materials: BuildMaterials;
  build: string;
  parts: string;
  power: string;
  raw: string;
  readiness: SessionReadiness;
  ready: string;
}

export interface SessionView {
  heading: string;
  builds: SessionBuild[];
  total: { build: string; parts: string; power: string };
  note: string;
  // Open steps after the session's builds that build a line, which the page counts.
  later: number;
}

// The session's builds: the phase's open steps that build a line (its own step, with something to
// build on it), in the order the build plan shows its unfinished steps: its order, the lines a
// delivered part leaves without work last (idleStepNotes, #1062).
function openBuilds(): { id: string; title: string; row: CalcRow }[] {
  const steps = planTasks(),
    idle = idleStepNotes(steps);
  const open = steps.filter(step => !stepDone(step));
  return [...open.filter(step => !idle.has(step.id)), ...open.filter(step => idle.has(step.id))]
    .map(step => ({ id: step.id, title: step.title, row: stepRow(step.id) }))
    .filter((build): build is { id: string; title: string; row: CalcRow } => !!build.row)
    .filter(build => rowMaterials(build.row).buildings.length > 0);
}

// Whether a line of the phase shown runs: marked running here, or carried from the phase before
// (#1069).
const runs = (row: CalcRow, carried: ReadonlySet<string>): boolean =>
  checked('calc-' + stage() + '-' + row.id) || carried.has(row.id);

// The raw resources `row` draws that no line of the stage makes: "Iron Ore 240/min, Water 27.89
// m³/min".
function rawInputs(row: CalcRow, snapshot: StoredStage): string[] {
  return Object.entries(row.inputs || {})
    .filter(([item]) => !makers(row, snapshot, item).length && (snapshot.raw?.[item] ?? 0) > 0)
    .map(([item, rate]) => item + ' ' + itemRate(item, rate));
}

// The other lines of the stage making `item`.
const makers = (row: CalcRow, snapshot: StoredStage, item: string): CalcRow[] =>
  (snapshot.rows || []).filter(
    other => other.id !== row.id && (other.outputs?.[item] ?? 0) > LINK_DUST,
  );

// A line feeding a build, named as its step: "Iron Ingot" when it is named after the item it
// gives, else "Residual Fuel (for Polymer Resin)".
const lineFor = (line: string, item: string): string =>
  line === item ? line : `${line} (for ${item})`;

// "builds 1 and 2", "build 1".
const buildNumbers = (numbers: number[]): string =>
  (numbers.length === 1 ? 'build ' : 'builds ') +
  numbers.slice(0, -1).join(', ') +
  (numbers.length > 1 ? ' and ' : '') +
  numbers.at(-1);

// Whether what feeds `row` already runs, and in words: each input made by lines of the stage that
// are not marked running (and not built earlier in this session), and whether its raw resources
// wait on the phase's open mining step.
function readinessOf(
  row: CalcRow,
  number: number,
  snapshot: StoredStage,
  session: ReadonlyMap<string, number>,
  mining: string,
): { readiness: SessionReadiness; ready: string } {
  const carried = new Set(currentCarry()?.shares.keys() ?? []);
  const after = new Set<number>(),
    waiting: string[] = [];
  for (const item of Object.keys(row.inputs || {}))
    for (const maker of makers(row, snapshot, item)) {
      if (runs(maker, carried)) continue;
      const earlier = session.get(maker.id);
      if (earlier !== undefined && earlier < number) after.add(earlier);
      else waiting.push(lineFor(stepRowName(maker), item));
    }
  const minedLater = !!mining && rawInputs(row, snapshot).length > 0;
  const sentences = [
    ...(waiting.length
      ? [`Waiting on lines not marked running: ${[...new Set(waiting)].join(', ')}.`]
      : []),
    ...(minedLater ? [`Its raw resources wait on the open step “${mining}”.`] : []),
    ...(after.size ? [`Ready once ${buildNumbers([...after].sort((a, b) => a - b))} runs.`] : []),
  ];
  if (!sentences.length)
    return { readiness: 'ready', ready: 'Ready: what feeds it already runs or is mined.' };
  return {
    readiness: waiting.length || minedLater ? 'waiting' : 'after',
    ready: sentences.join(' '),
  };
}

// A line's power in words: what a generator makes, else what the line draws at full load.
const powerWords = (row: CalcRow): string =>
  row.generationMW > 0
    ? `Makes ${power(row.generationMW)}`
    : `Draws ${power(lineLoad(row).peak)} at full load`;

// The phase's open mining step (`mining-<stage>`), by title, or '' when it is done or not listed.
function openMiningStep(): string {
  const step = planTasks().find(task => task.id === 'mining-' + stage());
  return step && !stepDone(step) ? step.title : '';
}

// Today's session for the phase shown, with at most `size` builds; null without a stage (no
// calculated profile, or a milestone-only phase).
export function sessionView(size: number): SessionView | null {
  const snapshot = calcStage();
  if (!snapshot) return null;
  const all = openBuilds(),
    chosen = all.slice(0, size);
  const session = new Map(chosen.map((build, i) => [build.row.id, i + 1]));
  const mining = openMiningStep();
  const builds = chosen.map(({ id, title, row }, i): SessionBuild => {
    const materials = rowMaterials(row);
    return {
      id,
      number: i + 1,
      title,
      factory: rowFactory(row)?.name ?? null,
      materials,
      build: buildWords(materials),
      parts: partsWords(materials),
      power: powerWords(row),
      raw: rawInputs(row, snapshot).join(', '),
      ...readinessOf(row, i + 1, snapshot, session, mining),
    };
  });
  const total = addMaterials(builds.map(build => build.materials));
  const draw = chosen.reduce(
    (sum, { row }) => sum + (row.generationMW > 0 ? 0 : lineLoad(row).peak),
    0,
  );
  const made = chosen.reduce((sum, { row }) => sum + Math.max(0, row.generationMW), 0);
  const heading = phaseLabel(phase());
  return {
    heading,
    builds,
    total: {
      build: buildWords(total),
      parts: partsWords(total),
      power: [
        ...(draw > 0 ? [`Draws ${power(draw)} at full load`] : []),
        ...(made > 0 ? [`${draw > 0 ? 'makes' : 'Makes'} ${power(made)}`] : []),
      ].join(', '),
    },
    note: todoNote(
      heading,
      builds.map(build => ({
        title: build.title,
        buildings: buildWords({ ...build.materials, lanes: [] }),
      })),
      total.parts,
    ),
    later: all.length - chosen.length,
  };
}
