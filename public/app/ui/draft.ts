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
// handler puts the saved value back itself (settle, reset or resetDraft below), whether the entry was
// refused, saved or failed to save.
import {
  customRef,
  effectScope,
  getCurrentScope,
  isRef,
  onScopeDispose,
  reactive,
  toRaw,
  watch,
  type EffectScope,
  type Ref,
} from 'vue';

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

// A field per key, for a list drawn with v-for: `saved` reads every key's saved value. Each key
// has a draft of its own, from useDraft, so the same rule holds for every field: a new saved value
// replaces a key's draft only while nothing has been typed in it since it last took the saved
// value, not while it still shows the value saved before (#683). A new key gets its saved value,
// and a key that goes loses its draft, so it comes back untouched. The record returned unwraps
// the drafts: reading a key reads its draft and writing a key (the input event) types in it. A
// handler puts the saved value back after its commit with resetDraft.
export function useDrafts(saved: () => Record<string, string>) {
  const drafts = reactive<Record<string, string>>({}),
    scopes = new Map<string, EffectScope>();
  const add = (key: string) => {
    const scope = effectScope(true);
    scopes.set(key, scope);
    (drafts as Record<string, unknown>)[key] = scope.run(() => useDraft(() => saved()[key] ?? ''));
  };
  for (const key of Object.keys(saved())) add(key);
  watch(
    () => Object.keys(saved()),
    keys => {
      for (const [key, scope] of scopes)
        if (!keys.includes(key)) {
          scope.stop();
          scopes.delete(key);
          delete drafts[key];
        }
      for (const key of keys) if (!scopes.has(key)) add(key);
    },
  );
  if (getCurrentScope()) onScopeDispose(() => scopes.forEach(scope => scope.stop()));
  return drafts;
}

// reset() for one key of useDrafts: its saved value again, untouched.
export function resetDraft(drafts: Record<string, string>, key: string, saved: string) {
  const draft = (toRaw(drafts) as Record<string, unknown>)[key];
  if (isRef(draft)) reset(draft as Ref<string>, saved);
  else drafts[key] = saved;
}
