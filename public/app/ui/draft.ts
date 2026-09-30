// What a field that saves on change shows: the saved value, then what the user types (#627,
// #654). Vue writes a bound value back into a field on every redraw of its component, and saving
// any control redraws everything that reads session state (the Saving indicator, then render()).
// Bound to the saved value, a field was put back over what was typed but not yet committed, and
// the change event that followed saved the old value. Bound to a draft instead, with its `input`
// event writing the draft, a redraw writes back what is being typed; a new saved value (the
// field's own save, a reload from another tab) still replaces it. A handler that refuses an
// entry, or whose save fails, puts the saved value back into the draft itself.
import { reactive, ref, watch } from 'vue';

// One field: `saved` reads its saved value.
export function useDraft(saved: () => string) {
  const draft = ref(saved());
  watch(saved, value => (draft.value = value));
  return draft;
}

// A field per key, for a list drawn with v-for: `saved` reads every key's saved value. A key
// whose saved value changes (or that is new) gets it; the others keep what is typed.
export function useDrafts(saved: () => Record<string, string>) {
  const drafts = reactive<Record<string, string>>({ ...saved() });
  watch(saved, (now, before) => {
    for (const [key, value] of Object.entries(now)) if (value !== before[key]) drafts[key] = value;
  });
  return drafts;
}
