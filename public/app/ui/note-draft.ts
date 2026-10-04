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
// when typing has gone on since.
//
// Conflicts (#1052): each write names the saved text it was typed over (`base`), and both
// editions refuse it (409, checkBase in state/mutate.ts) when the note now says something else.
// The box then shows both versions and saves nothing until the user picks one: keep mine, keep
// theirs or keep both (`conflict`, the other version's text). The same happens when the saved
// note changes underneath a draft some other way (the reply to another write, a refresh), so no
// keystroke ever replaces another person's text without that choice.
//
// A failed write keeps the draft and shows "Not saved" with Retry, which sends it again, as
// typing more does. Each box registers with api.ts (noteBoxes), so allowSwitch() sends a note
// still waiting for its pause before the page goes away and asks only about a note that would
// be lost. If a write fails after its box has gone (the page changed while it was on its
// way), the draft is kept here, for this save, profile and key, and the box shows it again,
// marked "Not saved", when it next opens; with the text it was typed over, so a note changed
// meanwhile opens as a conflict.
import { computed, onBeforeUnmount, onMounted, ref, watch, type ShallowRef } from 'vue';
import { noteBoxes, save, toast, type NoteBox } from '../api.ts';
import { currentProfile, currentSave, state } from '../session.ts';
import { legacy } from './bridge.ts';

// How long typing must pause before the note is written.
export const NOTE_SAVE_DELAY = 800;
// The longest note validateState accepts (and the box's maxlength).
export const NOTE_MAX = 6000;

export type NoteStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

// A blank note is saved by deleting it (mutate in state.ts), so whitespace compares as empty.
const blank = (text: string) => (text.trim() ? text : '');

// "Keep both": the other version first, then this box's text, a blank line between.
export const bothVersions = (theirs: string, mine: string) =>
  [theirs, mine].filter(text => blank(text)).join('\n\n');

// Drafts whose write failed after their box went away, by save/profile/key, with the saved text
// they were typed over. The next box to show that note takes the draft over (`adopt`), so it is
// dropped once that box saves it or the user agrees to leave without it.
type Orphan = { text: string; base: string };
const orphans = new Map<string, Orphan>();
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
  const text = ref(orphan?.text ?? saved());
  const status = ref<NoteStatus>(orphan === undefined ? 'idle' : 'failed');
  const savedAt = ref('');
  // The other version while the box asks which to keep, else null.
  const conflict = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The text of this box's write still on its way, and the last text it sent (blanked).
  let sending: string | null = null;
  let sent: string | null = null;
  // The saved text the box's text was typed over: what a write names as its `base`.
  let agreed = orphan?.base ?? saved();
  // Every text this box sent since it last agreed with the saved note (blanked): a saved note
  // that reads like one of them is the reply to its own write, not someone else's change.
  const own = new Set<string>();
  let mounted = false;

  // What the saved note will be once the write on its way lands.
  const target = () => blank(sending ?? saved());
  // The text on screen: the textarea's own value, which a script may have set without input.
  const current = () => el.value?.value ?? text.value;

  // The box and the saved note say the same again: nothing is left to choose or send.
  function agree(now: string) {
    agreed = now;
    own.clear();
    conflict.value = null;
  }
  // Another version was saved underneath the text on screen: show both and wait for a choice.
  // A box folded away in its phase panel opens, so the choice is in sight.
  function clash(theirs: string) {
    clearTimeout(timer);
    timer = undefined;
    conflict.value = theirs;
    status.value = 'conflict';
    const panel = el.value?.closest('details');
    if (panel && !panel.open) panel.open = true;
  }

  // Writes the text now, unless the saved note (or the write on its way) already has it.
  // `base` is the saved text the write replaces; a write while another is on its way replaces
  // that one's text.
  function send(key = noteKey(), boxId = id(), base = sending ?? agreed) {
    clearTimeout(timer);
    timer = undefined;
    const value = text.value;
    const here = boxId === id();
    if (here && conflict.value !== null) return;
    const goal = here ? target() : blank(state.notes[key] || '');
    if (blank(value) === goal) {
      if (sending === null && here) status.value = savedAt.value ? 'saved' : 'idle';
      return;
    }
    const write = ++writes;
    latest.set(boxId, write);
    sending = value;
    sent = blank(value);
    own.add(sent);
    status.value = 'saving';
    const mine = () => mounted && id() === boxId;
    save({ type: 'note', key, value, base }).then(
      () => {
        if (latest.get(boxId) !== write || !mine()) return;
        sending = null;
        // Another version came in while it was on its way: the question stays until answered.
        if (conflict.value !== null) {
          agreed = value;
          return;
        }
        agree(value);
        status.value = 'saved';
        savedAt.value = clock();
      },
      (error: { status?: number }) => {
        // save() has already shown the error in a toast, and after a refusal (409) the page
        // already shows the saved note the refusal is about (queuedWrite in api.ts).
        if (latest.get(boxId) !== write) return;
        if (!mine()) {
          orphans.set(boxId, { text: value, base });
          return;
        }
        sending = null;
        if (error?.status === 409 && blank(saved()) !== blank(base)) clash(saved());
        else if (conflict.value === null) status.value = 'failed';
      },
    );
  }

  // @input: wait for the pause in typing. The status line stays as it is until the write
  // starts, so it says "Saving…" only while something is being saved, and the live region
  // speaks once per write rather than on every first key press. While the box asks which
  // version to keep, typing changes only the text on screen.
  function typed() {
    clearTimeout(timer);
    if (conflict.value !== null) return;
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

  // The three answers to a conflict. Each takes the choice's buttons away, so focus goes to the
  // note first. "Keep theirs" saves nothing: the other version is already the saved note.
  // "Keep mine" and "Keep both" write over the other version as it was shown; if it changed
  // again meanwhile, that write is refused too and the box asks again.
  function keepMine() {
    const theirs = conflict.value;
    if (theirs === null) return;
    el.value?.focus();
    conflict.value = null;
    send(noteKey(), id(), theirs);
  }
  function keepTheirs() {
    const theirs = conflict.value;
    if (theirs === null) return;
    el.value?.focus();
    text.value = theirs;
    agree(theirs);
    status.value = 'idle';
  }
  function keepBoth() {
    const theirs = conflict.value;
    if (theirs === null) return;
    const both = bothVersions(theirs, current());
    if (both.length > NOTE_MAX) return;
    el.value?.focus();
    text.value = both;
    conflict.value = null;
    send(noteKey(), id(), theirs);
  }
  // "Keep both" has nothing to do when the two together are longer than a note can hold.
  const bothTooLong = computed(
    () => conflict.value !== null && bothVersions(conflict.value, text.value).length > NOTE_MAX,
  );

  watch([id, saved], ([boxId, now], [before, was]) => {
    if (boxId !== before) {
      // Another phase, profile or save. A note still waiting goes to its own key first. Only
      // within the same save and profile: save() writes to the open one. allowSwitch() sends
      // it before a switch, so otherwise it is kept as unsaved for when its box opens again.
      if (timer !== undefined) {
        const same = scope() + '/';
        if (before.startsWith(same)) send(before.slice(same.length), before, sending ?? agreed);
        else {
          clearTimeout(timer);
          timer = undefined;
          orphans.set(before, { text: text.value, base: sending ?? agreed });
        }
      }
      const kept = adopt(boxId);
      text.value = kept?.text ?? now;
      agreed = kept?.base ?? now;
      own.clear();
      conflict.value = null;
      status.value = kept === undefined ? 'idle' : 'failed';
      savedAt.value = '';
      sending = null;
      sent = null;
      if (kept !== undefined && blank(now) !== blank(kept.base) && blank(now) !== blank(kept.text))
        clash(now);
      return;
    }
    // The box showed the saved note (or the same text): it simply shows the new one.
    if ((text.value === was && conflict.value === null) || blank(text.value) === blank(now)) {
      text.value = now;
      agree(now);
      if (status.value === 'conflict') status.value = 'idle';
      return;
    }
    // The reply to one of this box's own writes, or the note going back to the text it was
    // typed over, while typing went on: nothing to choose.
    if (own.has(blank(now)) || (conflict.value === null && blank(now) === blank(agreed))) return;
    // A write of this box still on its way names the older text, so it will be refused, and
    // save() then says so in the toast; otherwise the toast says it here, once.
    const quiet = conflict.value !== null || sending !== null;
    clash(now);
    if (!quiet)
      toast(
        'A note was changed in another tab or on another device while you were editing it. Both versions are shown under the note: choose which to keep.',
      );
  });

  const box: NoteBox = {
    el: () => el.value,
    flush,
    conflict: () => conflict.value !== null,
    unsaved: () =>
      status.value === 'failed' || conflict.value !== null || blank(current()) !== blank(saved()),
    unsent: () => (timer === undefined && blank(current()) !== target()) || conflict.value !== null,
  };
  onMounted(() => {
    mounted = true;
    noteBoxes.add(box);
    // A draft taken over from a write that failed after its box went away: the note changed
    // meanwhile, so ask which to keep.
    if (orphan && blank(saved()) !== blank(orphan.base) && blank(saved()) !== blank(orphan.text))
      clash(saved());
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
          : status.value === 'conflict'
            ? 'Not saved — this note was changed elsewhere. Choose which version to keep.'
            : 'Saves as you type.',
  );

  return {
    text,
    status,
    message,
    conflict,
    bothTooLong,
    typed,
    flush,
    retry,
    keepMine,
    keepTheirs,
    keepBoth,
  };
}
