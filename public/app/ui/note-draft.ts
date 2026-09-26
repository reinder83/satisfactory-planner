// The text of a notes box that is saved only with its "Save notes" button (the plan pages'
// phase notes, the Backup page's save-wide notes). The box keeps its own text, so a redraw
// (a ticked step, the save indicator) does not put the saved note back over unsaved typing.
// It follows the saved note when the note itself changes (another phase, profile or save),
// and when the saved text changes while the box still shows the previous saved text. If the
// box holds a draft when the saved text changes underneath it (another tab saved the same
// note, or the reply to this box's own save arrives while typing continues), the draft is
// kept and a toast says so; saving it then replaces the other version.
import { ref, watch } from 'vue';
import { toast } from '../api.ts';

export function useNoteDraft(key: () => string, saved: () => string) {
  const text = ref(saved());
  watch([key, saved], ([k, now], [before, was]) => {
    if (k !== before || text.value === was || text.value === now) text.value = now;
    else
      toast(
        'The saved note changed while you were editing. Your unsaved text is kept; saving it replaces the saved version.',
      );
  });
  return text;
}
