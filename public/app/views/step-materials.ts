// What a production line's build-plan step takes to build (#1073), read beside the stored plan:
// the machines still to build on the line, the Water Extractors for the Water it extracts when the
// whole line is new, and the belt and pipe marks of the phase (bestLane in flow.ts), with the parts
// they cost (build-materials.ts). Nothing is stored or recalculated: a grown line counts only the
// machines to add, a line the phase before marked running only the machines this phase adds, and
// a generator line the generators the player already has leave to build, as their steps say.
import { wholeShares } from '../apportion.ts';
import {
  buildMaterials,
  buildWords,
  hasMaterials,
  partsWords,
  type BuildingCount,
  type BuildMaterials,
} from '../build-materials.ts';
import { bestLane, FLUIDS } from '../flow.ts';
import { carriedLine } from '../handover.ts';
import { calcStage, calculated, phase, state } from '../session.ts';
import { ownedBeyondKept } from '../../power.ts';
import { changedLine, grownLine, rowAdvice, spareLineOf } from './calculated.ts';
import type { CalcRow, Phase, StageKey, StoredStage } from '../../types/index.ts';

// The stage key ('1'-'5') phase `shownPhase` reads: Post Phase 5 shares Phase 5's.
const stageKeyOf = (shownPhase: Phase): StageKey => (shownPhase === 'post' ? '5' : shownPhase);

// Of the generators the player already has beyond those kept from the phase before (#1068), the
// ones left to build on `row`: what its building's lines still need, shared over those lines by
// their machines (wholeShares), as ownedGeneratorsText words it for one line. null for any other
// line.
function ownedLeft(row: CalcRow, snapshot: StoredStage | undefined): number | null {
  if (!(row.power < 0)) return null;
  const entry = ownedBeyondKept(snapshot?.grid).find(owned => owned.machine === row.machine);
  if (!entry) return null;
  const lines = (snapshot?.rows || []).filter(
    other => other.power < 0 && other.machine === row.machine,
  );
  const left = Math.max(0, entry.machines - Math.max(entry.owned ?? 0, entry.kept));
  const shares = wholeShares(
    left,
    lines.map(line => line.machines),
  );
  return shares[lines.findIndex(line => line.id === row.id)] ?? 0;
}

// The machines still to build on `row` in phase `shownPhase`, as its step says: the ones to add to
// a switched or grown line (#1175, #1174), none on a line with machines to spare, the ones this
// phase adds to a line the phase before marked running (#1069), the generators the player does not
// have yet (#1068), else every machine of the line.
function machinesToBuild(
  row: CalcRow,
  snapshot: StoredStage | undefined = calcStage(),
  shownPhase: Phase = phase(),
): number {
  const changed = changedLine(row, shownPhase);
  if (changed) return changed.add;
  const grown = grownLine(row, shownPhase);
  if (grown) return grown.add;
  if (spareLineOf(row, shownPhase)) return 0;
  const carried = calculated && carriedLine(calculated, state.checks, shownPhase, row.id);
  if (carried)
    return carried.before.machine === row.machine
      ? Math.max(0, row.machines - carried.before.machines)
      : row.machines;
  return ownedLeft(row, snapshot) ?? row.machines;
}

// The Water Extractors of the suggested option for the Water `row` extracts (#1024, #1142), as
// its byproduct advice gives them; 0 when it extracts none.
const waterExtractorsOf = (row: CalcRow, snapshot: StoredStage | undefined): number =>
  rowAdvice(row, snapshot).reduce((sum, line) => sum + (line.waterExtractors ?? 0), 0);

// The belt and pipe marks `row` is fed by in phase `shownPhase`: "Mk.4 belts" when an input or
// output is solid, "Mk.2 pipes" when one is a fluid.
function rowLanes(row: CalcRow, shownPhase: Phase = phase()): string[] {
  const items = [...Object.keys(row.inputs || {}), ...Object.keys(row.outputs || {})];
  const stageKey = stageKeyOf(shownPhase);
  return [
    ...(items.some(item => !FLUIDS.has(item)) ? [bestLane(false, stageKey).mark + ' belts'] : []),
    ...(items.some(item => FLUIDS.has(item)) ? [bestLane(true, stageKey).mark + ' pipes'] : []),
  ];
}

// What the step of `row` takes to build in phase `shownPhase` (the phase shown unless given): its
// machines still to build, the Water Extractors when the whole line is new, and its belts and
// pipes. Nothing to build gives no buildings and no lanes.
export function rowMaterials(
  row: CalcRow,
  snapshot: StoredStage | undefined = calcStage(),
  shownPhase: Phase = phase(),
): BuildMaterials {
  const count = machinesToBuild(row, snapshot, shownPhase);
  if (count <= 0) return buildMaterials([]);
  const buildings: BuildingCount[] = [{ building: row.machine, count }];
  if (count === row.machines) {
    const extractors = waterExtractorsOf(row, snapshot);
    if (extractors > 0) buildings.push({ building: 'Water Extractor', count: extractors });
  }
  return buildMaterials(buildings, rowLanes(row, shownPhase));
}

// The production line a build-plan step of phase `shownPhase` builds: the row of its own step,
// `calc-<stage>-<row id>`, in the stage shown; null for any other step (a personal task linked to
// the line included, which builds nothing of its own).
export function stepRow(stepId: string, shownPhase: Phase = phase()): CalcRow | null {
  if (!calculated || calculated.guide) return null;
  const prefix = 'calc-' + stageKeyOf(shownPhase) + '-';
  if (!stepId.startsWith(prefix)) return null;
  const rowId = stepId.slice(prefix.length);
  return calculated.stages[stageKeyOf(shownPhase)]?.rows?.find(row => row.id === rowId) ?? null;
}

// The materials of a build-plan step (rowMaterials), or null for a step that builds no line.
function stepMaterials(stepId: string, shownPhase: Phase = phase()): BuildMaterials | null {
  const row = stepRow(stepId, shownPhase);
  return row ? rowMaterials(row, calculated?.stages[stageKeyOf(shownPhase)], shownPhase) : null;
}

// A step's materials in words, as the build plan shows them under its text (ui/plan/PlanStep.vue):
// `build`, "2 Refineries + 1 Water Extractor + Mk.4 belts and Mk.2 pipes", and `parts`, "60 ×
// Steel Pipe, 40 × Copper Sheet, …". null for a step that builds no line, or nothing on it.
export interface StepMaterialWords {
  build: string;
  parts: string;
}
export function stepMaterialWords(
  stepId: string,
  shownPhase: Phase = phase(),
): StepMaterialWords | null {
  const materials = stepMaterials(stepId, shownPhase);
  return materials && hasMaterials(materials)
    ? { build: buildWords(materials), parts: partsWords(materials) }
    : null;
}
