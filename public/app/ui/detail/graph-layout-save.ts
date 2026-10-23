// Remembering how a factory's flow graph is drawn (#1224, slice 2 of #1201): the spots of the
// production lines the user moved, the zoom and the scroll offsets, stored per factory group as
// groups[].layout (state version 22) with the factoryGroupLayout update. FlowGraphDialog.vue reads
// the stored layout once as it opens and keeps the spots here while it is open, so a drag shows at
// once and the save's reply never moves a box back. A save goes:
// - when a drag of a line ends, at once (`now`);
// - when an arrow key nudge, a zoom or a scroll has settled, LAYOUT_SAVE_DELAY ms after the last
//   one (`later`), never on every pointer move;
// - when the dialog closes or makes way for a line's dialog, if one is still waiting.
// Only when the layout differs from what was last stored or sent, so opening the graph and
// putting the stored view back saves nothing. A save keeps the spots of the lines the factory has
// in some phase of the plan (factoryLineRows), so a line the plan dropped loses its spot then.
import { onBeforeUnmount, ref } from 'vue';
import { save } from '../../api.ts';
import { factoryLineRows, layoutToSave } from '../../graph-layout.ts';
import type { GraphView } from '../../graph-view.ts';
import { calculated } from '../../session.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import type { GroupLayout } from '../../../types/index.ts';

// How long a zoom, scroll or nudge rests before it is saved.
export const LAYOUT_SAVE_DELAY = 600;

// The stored layout of factory group `groupId`, if it has one.
export const storedGroupLayout = (groupId: string): GroupLayout | undefined =>
  factoryGroupsState().groups.find(group => group.id === groupId)?.layout;

// `view` gives the view on screen (null while the graph is not drawn).
export function useGraphLayout(groupId: string, view: () => GraphView | null) {
  const stored = storedGroupLayout(groupId);
  const spots = ref<Record<string, [number, number]>>(
    Object.fromEntries(
      Object.entries(stored?.nodes ?? {}).map(([row, [x, y]]) => [row, [x, y] as [number, number]]),
    ),
  );
  // What was last stored or sent, as JSON; '' after a failed save, which nothing equals.
  let last = JSON.stringify(stored ?? null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The view last seen on screen, for a save while the graph is not drawn: the stored one at first.
  let seen: GraphView = {
    zoom: stored?.zoom ?? 1,
    left: stored?.pan?.[0] ?? 0,
    top: stored?.pan?.[1] ?? 0,
  };

  function current(): GroupLayout | null {
    seen = view() ?? seen;
    const rows = Object.values(calculated?.stages ?? {}).map(stage => stage?.rows ?? []);
    return layoutToSave(spots.value, seen, factoryLineRows(rows, factoryGroupsState(), groupId));
  }
  function now() {
    clearTimeout(timer);
    timer = undefined;
    // A factory removed meanwhile (another tab) has nothing to keep.
    if (!factoryGroupsState().groups.some(group => group.id === groupId)) return;
    const layout = current();
    if (JSON.stringify(layout) === last) return;
    last = JSON.stringify(layout);
    save({ type: 'factoryGroupLayout', id: groupId, layout }).catch(() => {
      last = '';
    });
  }
  function later() {
    clearTimeout(timer);
    timer = setTimeout(now, LAYOUT_SAVE_DELAY);
  }
  // The view put back as the graph opens is what is stored: nothing to save for it.
  function settled() {
    last = JSON.stringify(current());
  }
  onBeforeUnmount(() => {
    if (timer !== undefined) now();
  });
  return { stored, spots, now, later, settled, storedView: seen };
}
