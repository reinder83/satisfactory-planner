// Remembering how the train network diagram is drawn (#1284, slice 4): the spots of the stations
// the user moved, the zoom and the scroll offsets, stored as `trainLayout` (state version 30) with
// the trainLayout update, the way a factory's flow graph keeps its layout (ui/detail/
// graph-layout-save.ts). TrainDiagram.vue reads the stored layout once as it is drawn and keeps
// the spots here, so a drag shows at once and the save's reply never moves a box back. A save goes
// at once when a drag ends or the layout is reset (`now`), LAYOUT_SAVE_DELAY after a nudge, a
// zoom or a scroll rests (`later`), and when the page goes with one waiting; only when it differs
// from what was last stored or sent. A save keeps only the spots of stations the profile has.
import { onBeforeUnmount, ref } from 'vue';
import { save } from '../../api.ts';
import type { GraphView } from '../../graph-view.ts';
import { state } from '../../session.ts';
import { trainLayoutToSave } from '../../train-diagram.ts';
import { LAYOUT_SAVE_DELAY } from '../detail/graph-layout-save.ts';

// `view` gives the view on screen (null while the diagram is not drawn).
export function useTrainLayout(view: () => GraphView | null) {
  const stored = state.trainLayout;
  const spots = ref<Record<string, [number, number]>>(
    Object.fromEntries(
      Object.entries(stored?.stations ?? {}).map(([id, [x, y]]) => [
        id,
        [x, y] as [number, number],
      ]),
    ),
  );
  let last = JSON.stringify(stored ?? null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seen: GraphView = {
    zoom: stored?.zoom ?? 1,
    left: stored?.pan?.[0] ?? 0,
    top: stored?.pan?.[1] ?? 0,
  };
  const current = () => {
    seen = view() ?? seen;
    const keep = new Set((state.trainStations ?? []).map(station => station.id));
    return trainLayoutToSave(spots.value, seen, keep);
  };
  function now() {
    clearTimeout(timer);
    timer = undefined;
    const layout = current();
    if (JSON.stringify(layout) === last) return;
    last = JSON.stringify(layout);
    save({ type: 'trainLayout', layout }).catch(() => {
      last = '';
    });
  }
  function later() {
    clearTimeout(timer);
    timer = setTimeout(now, LAYOUT_SAVE_DELAY);
  }
  // The view put back as the diagram is drawn is what is stored: nothing to save for it.
  function settled() {
    last = JSON.stringify(current());
  }
  onBeforeUnmount(() => {
    if (timer !== undefined) now();
  });
  return { spots, now, later, settled, storedView: seen };
}
