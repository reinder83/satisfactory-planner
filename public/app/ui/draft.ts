// What a field that saves on change shows: the saved value, then what the user types (#627,
// #654). Vue writes a bound value back into a field on every redraw of its component, and saving
// any control redraws everything that reads session state (the Saving indicator, then render()).
// Bound to the saved value, a field was put back over what was typed but not yet committed, and
// the change event that followed saved the old value. Bound to a draft instead, with its `input`
// event writing the draft, a redraw writes back what is being typed. A new saved value (a reload
// from another tab) replaces a draft only while it is untouched, still showing the value saved
// before: a field that stays editable while it saves can be typed in again meanwhile, and its own
// save then left that out (#664). After a commit, the handler puts the saved value back itself
// (settle below), whether the entry was refused, saved or failed to save.
import { reactive, ref, watch, type Ref } from 'vue';

// One field: `saved` reads its saved value.
export function useDraft(saved: () => string) {
  const draft = ref(saved());
  watch(saved, (value, before) => {
    if (draft.value === before) draft.value = value;
  });
  return draft;
}

// After a commit: the saved value again, unless something else has been typed since (#664),
// which stays for its own commit. `shown` is the draft when the commit started. Returns whether
// the saved value was put back.
export function settle(draft: Ref<string>, shown: string, saved: string) {
  if (draft.value !== shown) return false;
  draft.value = saved;
  return true;
}

// A field per key, for a list drawn with v-for: `saved` reads every key's saved value. A key
// whose saved value changes gets it while its draft is untouched, and a new key gets it; the
// others keep what is typed.
export function useDrafts(saved: () => Record<string, string>) {
  const drafts = reactive<Record<string, string>>({ ...saved() });
  watch(saved, (now, before) => {
    for (const [key, value] of Object.entries(now))
      if (!(key in before) || (value !== before[key] && drafts[key] === before[key]))
        drafts[key] = value;
  });
  return drafts;
}
