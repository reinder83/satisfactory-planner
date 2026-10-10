// The bridge between the planner's plain session state (session.ts, which is not reactive)
// and the Vue components. render() calls invalidate() after every change; a component that
// reads session state inside legacy() re-reads it then. Components converted later read
// reactive state directly and need no bridge.
import { ref } from 'vue';
import { redrawn } from '../per-redraw.ts';

const version = ref(0);

// Also starts a new redraw for what is worked out once per redraw (perRedraw, #1060).
export const invalidate = () => {
  redrawn();
  version.value++;
};

// Tracks the bridge in a computed() or template, then returns read(). Use it for every
// read of non-reactive session state, so the component refreshes when render() runs.
export function legacy<T>(read: () => T): T {
  version.value;
  return read();
}
