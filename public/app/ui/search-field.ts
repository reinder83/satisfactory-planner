// A search box over a plan's steps or lines (the build plan's step search, the Factories page's
// production line search): the box keeps what is typed to itself and hands the query to the
// page (`commit`) only once typing pauses for SEARCH_PAUSE_MS (#1060). Each key used to redraw
// the whole page, which took a second per key on a phone with a large plan. The box shows the
// typed text at once; the page filters when the query is handed over. A query the page changes
// itself (cleared on another page or profile) shows in the box, unless typing is still waiting.
// The storage search keeps filtering as you type: the storage room does not grow with the plan.
import { onBeforeUnmount, ref, watch } from 'vue';

// How long typing must pause before the page filters.
export const SEARCH_PAUSE_MS = 150;

// `committed` reads the page's query (session state, through legacy() so a redraw updates it);
// `commit` gives the page a new one. Bind `typed` as the box's value and `input` to its input
// event.
export function searchField(committed: () => string, commit: (value: string) => void) {
  const typed = ref(committed());
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(committed, value => {
    if (timer === undefined) typed.value = value;
  });
  function input(event: Event) {
    typed.value = (event.target as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      commit(typed.value);
    }, SEARCH_PAUSE_MS);
  }
  onBeforeUnmount(() => clearTimeout(timer));
  return { typed, input };
}
