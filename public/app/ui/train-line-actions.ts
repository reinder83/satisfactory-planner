// Saving and deleting a train line (#1284, slice 2), from the line editor (Save, Delete line) and
// the line's card ("Add rear locomotive"). Each write is one `trainLine` update through save(), so
// it reaches the profile it was made on and nothing else. A delete asks nothing: it says so in a
// toast with Undo (Ctrl+Z or ⌘Z too), as a deleted station does, which puts the line back as it
// was, after the others, only on the profile it was deleted from.
import { nextTick } from 'vue';
import { save, toast } from '../api.ts';
import { onProfile, profileScope, state, type ProfileScope } from '../session.ts';
import { render } from '../shell.ts';
import { lineDeletedNews, lineRestoredNews } from '../train-lines.ts';
import type { TrainLine } from '../../types/index.ts';

const fieldsOf = ({ id: _id, ...fields }: TrainLine): Omit<TrainLine, 'id'> => fields;

// Saves `line` whole: added when new, else replaced where it is. Resolves false when it was
// refused (save() has said why in a toast).
export async function saveLine(line: TrainLine): Promise<boolean> {
  try {
    await save({ type: 'trainLine', id: line.id, value: fieldsOf(line) });
    return true;
  } catch {
    return false;
  } finally {
    render();
  }
}

// The Logistics page's "Edit line" button of line `id`, where focus goes after a save.
export async function focusLine(id: string) {
  await nextTick();
  document.querySelector<HTMLElement>(`#main [data-line-edit="${CSS.escape(id)}"]`)?.focus();
}

// Deletes line `id` with an Undo in the toast. Focus is the caller's.
export async function deleteLine(id: string): Promise<boolean> {
  const line = state.trainLines?.find(entry => entry.id === id);
  if (!line) return false;
  const profile = profileScope();
  try {
    await save({ type: 'trainLine', id, value: null });
  } catch {
    render();
    return false;
  }
  render();
  toast(lineDeletedNews(line.name), false, {
    label: 'Undo',
    run: () => void undoDelete(line, profile),
  });
  return true;
}

// Undo, from the toast: puts the line back as it was (after the others), only on the profile it
// was deleted from and only while no line has its id again. A stop whose station was deleted in the
// meantime is left out, since the update refuses an unknown station.
async function undoDelete(line: TrainLine, profile: ProfileScope) {
  if (!onProfile(profile) || state.trainLines?.some(entry => entry.id === line.id)) return;
  const known = new Set((state.trainStations ?? []).map(station => station.id));
  if (!(await saveLine({ ...line, stops: line.stops.filter(stop => known.has(stop)) }))) return;
  toast(lineRestoredNews(line.name));
  await focusLine(line.id);
}
