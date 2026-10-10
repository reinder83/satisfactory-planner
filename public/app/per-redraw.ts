// What several components work out from session state on every redraw, worked out once per
// redraw (#1060). invalidate() in ui/bridge.ts, which render() calls after every change, counts
// the redraws (redrawn). Not part of the Vue layer, so the plain modules that use it (the build
// plan's steps, views/calculated.ts) work the same without the components.
let redraws = 0;

// A redraw: everything kept below is worked out again when next asked for.
export const redrawn = () => {
  redraws++;
};

// `compute` for each key, worked out once per redraw: what it gave is kept until the next redraw,
// or until one of `inputs()` (the session values it reads, such as the open plan and the progress
// state, which a save replaces rather than changes) is another value than when it was worked out.
// Several components of one page ask for the same build-plan steps on every redraw; this lets
// them share one answer. Callers must not change what it returns.
export function perRedraw<K, T>(
  inputs: () => readonly unknown[],
  compute: (key: K) => T,
): (key: K) => T {
  let seen: readonly unknown[] = [];
  let kept = new Map<K, T>();
  return key => {
    const now = [redraws, ...inputs()];
    if (now.length !== seen.length || now.some((input, i) => input !== seen[i])) {
      seen = now;
      kept = new Map();
    }
    if (!kept.has(key)) kept.set(key, compute(key));
    // Set just above when it was missing.
    return kept.get(key)!;
  };
}
