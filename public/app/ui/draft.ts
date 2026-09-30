// What a field that saves on change shows: the saved value, then what the user types (#627,
// #654). Vue writes a bound value back into a field on every redraw of its component, and saving
// any control redraws everything that reads session state (the Saving indicator, then render()).
// Bound to the saved value, a field was put back over what was typed but not yet committed, and
// the change event that followed saved the old value. Bound to a draft instead, with its `input`
// event writing the draft, a redraw writes back what is being typed. A new saved value (a reload
// from another tab) replaces a draft only while it is untouched, nothing typed in it since it
// last took the saved value: a field that stays editable while it saves can be typed in again
// meanwhile, and its own save then left that out (#664). Untouched is whether the user typed, not
// whether the text still equals the value saved before: a count typed back to that value during
// its own save looked untouched, and the save's result replaced it (#678). After a commit, the
// handler puts the saved value back itself (settle or reset below), whether the entry was
// refused, saved or failed to save.
import { customRef, reactive, watch, type Ref } from 'vue';

// How each draft of useDraft takes a saved value, which leaves it untouched again.
const adopters = new WeakMap<Ref<string>, (value: string) => void>();

// One field: `saved` reads its saved value. Writing the draft (the field's input event) marks
// it typed in; a new saved value replaces it only while it is not.
export function useDraft(saved: () => string): Ref<string> {
  let text = saved(),
    typed = false,
    changed = () => {};
  const draft = customRef<string>((track, trigger) => {
    changed = trigger;
    return {
      get: () => (track(), text),
      set: value => {
        text = value;
        typed = true;
        trigger();
      },
    };
  });
  const adopt = (value: string) => {
    text = value;
    typed = false;
    changed();
  };
  adopters.set(draft, adopt);
  watch(saved, value => {
    if (!typed) adopt(value);
  });
  return draft;
}

// The saved value again, untouched, so the next saved value replaces it: for a handler that puts
// the saved value back after its commit. Writing `draft.value` instead marks the draft typed in.
export function reset(draft: Ref<string>, saved: string) {
  const adopt = adopters.get(draft);
  if (adopt) adopt(saved);
  else draft.value = saved;
}

// After a commit: the saved value again, unless something else has been typed since (#664),
// which stays for its own commit. `shown` is the draft when the commit started. Returns whether
// the saved value was put back.
export function settle(draft: Ref<string>, shown: string, saved: string) {
  if (draft.value !== shown) return false;
  reset(draft, saved);
  return true;
}

// A field per key, for a list drawn with v-for: `saved` reads every key's saved value. A key
// whose saved value changes gets it while its draft is untouched, and a new key gets it; the
// others keep what is typed. Untouched here still means showing the value saved before: these
// fields are read-only while they save (app/busy.ts), so none is typed back to it meanwhile.
export function useDrafts(saved: () => Record<string, string>) {
  const drafts = reactive<Record<string, string>>({ ...saved() });
  watch(saved, (now, before) => {
    for (const [key, value] of Object.entries(now))
      if (!(key in before) || (value !== before[key] && drafts[key] === before[key]))
        drafts[key] = value;
  });
  return drafts;
}
