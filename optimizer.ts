// Thin wrapper around the HiGHS LP/MIP solver (WebAssembly, the `highs` npm package). Its only
// caller is `run` in planner.ts. The package loads highs.wasm from next to its own module, in
// Node and in the browser. build.ts rewrites the import for the Pages edition (highs.mjs next to
// highs.wasm), so keep it exactly as written.
import loadHighs from 'highs';

// A model in the planner's shape (see solve below).
export interface LpModel {
  optimize: string;
  opType: 'max' | 'min';
  constraints: Record<string, { min?: number; max?: number; equal?: number }>;
  variables: Record<string, Record<string, number>>;
  bounds?: Record<string, number>;
  ints?: Record<string, number>;
}

// What solve returns: HiGHS's status, and every variable's value by name.
export interface LpSolution {
  solverStatus: string;
  feasible: boolean;
  bounded: boolean;
  values: Record<string, number>;
}

// Loaded once, when the module is first imported (server start, or the browser worker's import).
const highs = await loadHighs();
// Solves one model and returns every variable's value by name.
//
// The model shape is the planner's own:
//   optimize     the name of the objective's coefficient key ('cost' or 'gain')
//   opType       'max' or 'min'
//   constraints  { name: { min?, max?, equal? } }; a row with both min and max becomes two rows
//   variables    { name: { [constraint or objective key]: coefficient } }
//   bounds       optional { name: upper bound }; every variable is otherwise just >= 0
//   ints         optional { name: 1 } for integer (whole-machine or amplified) variables
//
// Returns { solverStatus, feasible, bounded, values }, with a variable HiGHS reports no value
// for read as 0. `feasible` and `bounded` are both simply "HiGHS said Optimal": a MIP stopped by
// the time limit, even with a usable incumbent, counts as not feasible, and `run`/`calculate`
// tell that case apart from a real shortage by `solverStatus`.
export function solve(model: LpModel): LpSolution {
  // Variables and constraints are renamed v0, v1, … and c0, c1, … because the planner's names
  // ('item:Iron Plate', 'raw:Crude Oil', 'amp:Recipe_…') are not valid LP-format names.
  const names = Object.keys(model.variables),
    vars = names.map((_, i) => 'v' + i);
  // One linear expression over the coefficients stored under `key`. An expression with no terms
  // is written as '0 v0' so the LP text stays parseable.
  const expression = (key: string) =>
    names
      .map((n, i): [number, string] => [model.variables[n]![key] || 0, vars[i]!])
      .filter(([q]) => q !== 0)
      .map(([q, n]) => `${q < 0 ? '-' : '+'} ${Math.abs(q)} ${n}`)
      .join(' ') || '0 v0';
  const lines = [
    model.opType === 'max' ? 'Maximize' : 'Minimize',
    'objective: ' + expression(model.optimize),
    'Subject To',
  ];
  let i = 0;
  for (const [key, b] of Object.entries(model.constraints)) {
    const e = expression(key);
    if (b.equal !== undefined) lines.push(`c${i++}: ${e} = ${b.equal}`);
    else {
      if (b.min !== undefined) lines.push(`c${i++}: ${e} >= ${b.min}`);
      if (b.max !== undefined) lines.push(`c${i++}: ${e} <= ${b.max}`);
    }
  }
  lines.push(
    'Bounds',
    ...names.map((n, i) =>
      model.bounds?.[n] !== undefined ? `0 <= ${vars[i]} <= ${model.bounds[n]}` : vars[i] + ' >= 0',
    ),
  );
  const integers = names.map((n, i) => (model.ints?.[n] ? vars[i] : null)).filter(Boolean);
  if (integers.length) lines.push('Generals', integers.join(' '));
  lines.push('End');
  // Three seconds per solve, not per plan: `calculate` makes several solves per phase. The
  // integer searches are the ones that can hit it (see AMPLIFY_CANDIDATES in planner.ts).
  const r = highs.solve(lines.join('\n'), { output_flag: false, time_limit: 3 });
  // A column of an infeasible solution carries no value; it, and a missing one, read as 0.
  const primal = (name: string) => {
    const c = r.Columns?.[name];
    return (c && 'Primal' in c && c.Primal) || 0;
  };
  return {
    solverStatus: r.Status,
    feasible: r.Status === 'Optimal',
    bounded: r.Status === 'Optimal',
    values: Object.fromEntries(names.map((n, i) => [n, primal(vars[i]!)])),
  };
}
