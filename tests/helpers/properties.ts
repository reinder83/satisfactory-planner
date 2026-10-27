// The heavy property and sweep tests check a deterministic sample of their cases on pull requests,
// pushes and a local `npm test`, and every case with PLANNER_FULL_PROPERTIES=1: the nightly
// workflow (.github/workflows/nightly.yml), on demand through its workflow_dispatch, or locally
// with `PLANNER_FULL_PROPERTIES=1 node --test tests/*.test.ts` (#1274). No case is dropped: the
// sample is a subset of the full set, and it holds the regression cases a test lists in `keep`
// (for a test with many named seeds that can be one per kind of case; the rest run nightly).
export const FULL_PROPERTIES = process.env.PLANNER_FULL_PROPERTIES === '1';

type Sample<T> = {
  // The cases the sample always holds (each must be one of the cases).
  keep?: readonly T[];
  // Besides those, every `every`-th case, from the `offset`-th on (none when left out).
  every?: number;
  offset?: number;
};

// The cases a property test checks: all of `all` with PLANNER_FULL_PROPERTIES=1, otherwise
// `sample`'s, in the order of `all`.
export function propertyCases<T>(all: readonly T[], sample: Sample<T>): T[] {
  const keep = sample.keep ?? [];
  for (const kept of keep)
    if (!all.includes(kept)) throw new Error(`the kept case ${String(kept)} is not a case`);
  if (FULL_PROPERTIES) return [...all];
  const { every, offset = 0 } = sample;
  return all.filter(
    (item, index) =>
      keep.includes(item) || (!!every && index >= offset && (index - offset) % every === 0),
  );
}

// A count for the mode the tests run in: `full` with PLANNER_FULL_PROPERTIES=1, else `sampled`.
// For the rounds of a property check that draws each round from one random sequence (the sample
// is then its first rounds, which draw as they always did) and for the least a check must cover.
export const propertyCount = (full: number, sampled: number): number =>
  FULL_PROPERTIES ? full : sampled;
