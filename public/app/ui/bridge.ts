// The bridge between the planner's plain session state (session.ts, which is not reactive)
// and the Vue components. render() calls invalidate() after every change; a component that
// reads session state inside legacy() re-reads it then. Components converted later read
// reactive state directly and need no bridge.
import { ref } from 'vue';

const version = ref(0);

export const invalidate = () => version.value++;

// Tracks the bridge in a computed() or template, then returns read(). Use it for every
// read of non-reactive session state, so the component refreshes when render() runs.
export function legacy<T>(read: () => T): T {
  version.value;
  return read();
}

// `compute` for each key, worked out once per redraw (#1060): what it gave is kept until render()
// runs again, or until one of `inputs()` (the session values it reads, such as the open plan and
// the progress state, which a save replaces rather than changes) is another value than when it
// was worked out. Several components of one page ask for the same build-plan steps on every
// redraw; this lets them share one answer. Callers must not change what it returns.
export function perRedraw<K, T>(
  inputs: () => readonly unknown[],
  compute: (key: K) => T,
): (key: K) => T {
  let seen: readonly unknown[] = [];
  let kept = new Map<K, T>();
  return key => {
    const now = [version.value, ...inputs()];
    if (now.length !== seen.length || now.some((input, i) => input !== seen[i])) {
      seen = now;
      kept = new Map();
    }
    if (!kept.has(key)) kept.set(key, compute(key));
    // Set just above when it was missing.
    return kept.get(key)!;
  };
}
