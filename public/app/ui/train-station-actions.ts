// Saving and deleting a train station (#1284, slice 1), from the station dialog (Save, Delete
// station). Each write is one `trainStation` update through save(), so it reaches the profile it
// was made on and nothing else. A delete asks nothing: it says so in a toast with Undo (Ctrl+Z or
// ⌘Z too), the app's way for a removal that is quick to make again (public/AGENTS.md), which puts
// the station back as it was, after the others, only on the profile it was deleted from.
import { nextTick } from 'vue';
import { save, toast } from '../api.ts';
import { onProfile, profileScope, state, type ProfileScope } from '../session.ts';
import { render } from '../shell.ts';
import { stationDeletedNews, stationRestoredNews } from '../train-stations.ts';
import type { TrainStation } from '../../types/index.ts';

const fieldsOf = ({ id: _id, ...fields }: TrainStation): Omit<TrainStation, 'id'> => fields;

// Saves `station` whole: added when new, else replaced where it is. Resolves false when it was
// refused (save() has said why in a toast).
export async function saveStation(station: TrainStation): Promise<boolean> {
  try {
    await save({ type: 'trainStation', id: station.id, value: fieldsOf(station) });
    return true;
  } catch {
    return false;
  } finally {
    render();
  }
}

// The Logistics page's "Edit" button of station `id`, where focus goes after a save.
export const stationButton = (id: string) =>
  document.querySelector<HTMLElement>(`#main [data-station-edit="${CSS.escape(id)}"]`);

export async function focusStation(id: string) {
  await nextTick();
  stationButton(id)?.focus();
}

// Deletes station `id` with an Undo in the toast. Focus is the caller's.
export async function deleteStation(id: string): Promise<boolean> {
  const station = state.trainStations?.find(entry => entry.id === id);
  if (!station) return false;
  const profile = profileScope();
  try {
    await save({ type: 'trainStation', id, value: null });
  } catch {
    render();
    return false;
  }
  render();
  toast(stationDeletedNews(station.name), false, {
    label: 'Undo',
    run: () => void undoDelete(station, profile),
  });
  return true;
}

// Undo, from the toast: puts the station back as it was (after the others), only on the profile
// it was deleted from and only while no station has its id again. A factory owner removed in the
// meantime is refused by the update, so the station comes back without it.
async function undoDelete(station: TrainStation, profile: ProfileScope) {
  if (!onProfile(profile) || state.trainStations?.some(entry => entry.id === station.id)) return;
  const owner = station.owner;
  const known =
    owner?.kind !== 'factory' || state.factoryGroups.groups.some(group => group.id === owner.id);
  const { owner: _owner, ...rest } = station;
  if (!(await saveStation(known ? station : rest))) return;
  toast(stationRestoredNews(station.name));
  await focusStation(station.id);
}
