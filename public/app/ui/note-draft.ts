// A notes box that saves itself (#237): the Notes page's save-wide and phase notes (#243)
// and the notes in factory and container dialogs, all drawn by NoteBox.vue.
// The text is saved through save() in api.ts 800 ms after typing stops, and at once when the
// box loses focus, so a pause writes once rather than once per keystroke. The notes keys are
// saved progress and do not change: `phase-<phase>`, `global`, `factory-<id>`, `slot-<address>`.
//
// The box keeps its own text, so a redraw (a ticked step, the save indicator) does not put the
// saved note back over typing. It follows the saved note when the note itself changes (another
// phase, profile or save), and when the saved text changes while the box still shows the
// previous saved text. The reply to the box's own write is not a change underneath it, even
// when typing has gone on since. If another tab saves the same note while this box holds a
// draft, the draft is kept and a toast says so; its next save replaces the other version.
//
// A failed write keeps the draft and shows "Not saved" with Retry, which sends it again, as
// typing more does. Each box registers with api.ts (noteBoxes), so allowSwitch() sends a note
// still waiting for its pause before the page goes away and asks only about a note that would
// be lost. If a write fails after its box has gone (the page changed while it was on its
// way), the draft is kept here, for this save, profile and key, and the box shows it again,
// marked "Not saved", when it next opens.
import { computed, onBeforeUnmount, onMounted, ref, watch, type ShallowRef } from 'vue';
import { noteBoxes, save, toast, type NoteBox } from '../api.ts';
import { currentProfile, currentSave, state } from '../session.ts';
import { legacy } from './bridge.ts';

// How long typing must pause before the note is written.
export const NOTE_SAVE_DELAY = 800;

export type NoteStatus = 'idle' | 'saving' | 'saved' | 'failed';

// A blank note is saved by deleting it (mutate in state.ts), so whitespace compares as empty.
const blank = (text: string) => (text.trim() ? text : '');

// Drafts whose write failed after their box went away, by save/profile/key. The next box to
// show that note takes the draft over (`adopt`), so it is dropped once that box saves it or
// the user agrees to leave without it.
const orphans = new Map<string, string>();
const adopt = (id: string) => {
  const draft = orphans.get(id);
  orphans.delete(id);
  return draft;
};
// The latest write sent for each save/profile/key, so an older reply is not taken for it.
const latest = new Map<string, number>();
let writes = 0;

const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// `el` is the box's textarea (a template ref).
export function useNoteAutosave(
  noteKey: () => string,
  el: Readonly<ShallowRef<HTMLTextAreaElement | null>>,
) {
  // The save, profile and key this box shows; `scope` alone is the save and profile.
  const scope = () => legacy(() => (currentSave?.id || '') + '/' + (currentProfile?.id || ''));
  const id = () => scope() + '/' + noteKey();
  const saved = () => legacy(() => state.notes[noteKey()] || '');

  const orphan = adopt(id());
  const text = ref(orphan ?? saved());
  const status = ref<NoteStatus>(orphan === undefined ? 'idle' : 'failed');
  const savedAt = ref('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The text of this box's write still on its way, and the last text it sent (blanked).
  let sending: string | null = null;
  let sent: string | null = null;
  let mounted = false;

  // What the saved note will be once the write on its way lands.
  const target = () => blank(sending ?? saved());
  // The text on screen: the textarea's own value, which a script may have set without input.
  const current = () => el.value?.value ?? text.value;

  // Writes the text now, unless the saved note (or the write on its way) already has it.
  function send(key = noteKey(), boxId = id()) {
    clearTimeout(timer);
    timer = undefined;
    const value = text.value;
    const base = boxId === id() ? target() : blank(state.notes[key] || '');
    if (blank(value) === base) {
      if (sending === null) status.value = savedAt.value ? 'saved' : 'idle';
      return;
    }
    const write = ++writes;
    latest.set(boxId, write);
    sending = value;
    sent = blank(value);
    status.value = 'saving';
    const mine = () => mounted && id() === boxId;
    save({ type: 'note', key, value }).then(
      () => {
        if (latest.get(boxId) !== write || !mine()) return;
        sending = null;
        status.value = 'saved';
        savedAt.value = clock();
      },
      () => {
        // save() has already shown the error in a toast.
        if (latest.get(boxId) !== write) return;
        if (!mine()) {
          orphans.set(boxId, value);
          return;
        }
        sending = null;
        status.value = 'failed';
      },
    );
  }

  // @input: wait for the pause in typing. The status line stays as it is until the write
  // starts, so it says "Saving…" only while something is being saved, and the live region
  // speaks once per write rather than on every first key press.
  function typed() {
    clearTimeout(timer);
    timer = setTimeout(() => send(), NOTE_SAVE_DELAY);
  }
  // @blur, and allowSwitch() before the box goes away: send a waiting note now.
  function flush() {
    if (timer !== undefined) send();
  }
  // Retry after a failed write. The button goes as soon as the write starts (v-if in
  // NoteBox.vue), so focus moves to the note first rather than falling to <body> (#283).
  function retry() {
    el.value?.focus();
    send();
  }

  watch([id, saved], ([boxId, now], [before, was]) => {
    if (boxId !== before) {
      // Another phase, profile or save. A note still waiting goes to its own key first. Only
      // within the same save and profile: save() writes to the open one. allowSwitch() sends
      // it before a switch, so otherwise it is kept as unsaved for when its box opens again.
      if (timer !== undefined) {
        const same = scope() + '/';
        if (before.startsWith(same)) send(before.slice(same.length), before);
        else {
          clearTimeout(timer);
          timer = undefined;
          orphans.set(before, text.value);
        }
      }
      const kept = adopt(boxId);
      text.value = kept ?? now;
      status.value = kept === undefined ? 'idle' : 'failed';
      savedAt.value = '';
      sending = null;
      sent = null;
      return;
    }
    if (text.value === was || blank(text.value) === blank(now)) text.value = now;
    else if (blank(now) !== sent)
      toast(
        'The saved note changed while you were editing. Your text is kept; saving it replaces the saved version.',
      );
  });

  const box: NoteBox = {
    el: () => el.value,
    flush,
    unsaved: () => status.value === 'failed' || blank(current()) !== blank(saved()),
    unsent: () => timer === undefined && blank(current()) !== target(),
  };
  onMounted(() => {
    mounted = true;
    noteBoxes.add(box);
  });
  onBeforeUnmount(() => {
    flush();
    mounted = false;
    noteBoxes.delete(box);
  });

  // The status line under the box.
  const message = computed(() =>
    status.value === 'saving'
      ? 'Saving…'
      : status.value === 'saved'
        ? 'Saved · ' + savedAt.value
        : status.value === 'failed'
          ? 'Not saved —'
          : 'Saves as you type.',
  );

  return { text, status, message, typed, flush, retry };
}
