// Saving and deleting a marker on the world map (#1283, slice 2), from the map page (a drag, an
// arrow key, Delete) and from the marker dialog (Save, Delete marker). Each write is one
// `mapMarker` update through save(), so it reaches the profile it was made on and nothing else.
// A delete asks nothing: it says so in a toast with Undo (Ctrl+Z or ⌘Z too), the app's way for a
// removal that is quick to make again (public/AGENTS.md), which puts the marker back as it was,
// only on the profile it was deleted from.
import { nextTick } from 'vue';
import { save, toast } from '../api.ts';
import { markerDeletedNews, markerRestoredNews } from '../map-markers.ts';
import { onProfile, profileScope, state, type ProfileScope } from '../session.ts';
import { render } from '../shell.ts';
import type { MapMarker } from '../../types/index.ts';

// The marker's fields as the update sends them (its id goes beside them).
const fieldsOf = ({ id: _id, ...fields }: MapMarker): Omit<MapMarker, 'id'> => fields;

// Saves `marker` whole: placed when new, else replaced. Resolves false when it was refused (save()
// has said why in a toast).
export async function saveMarker(marker: MapMarker): Promise<boolean> {
  try {
    await save({ type: 'mapMarker', id: marker.id, value: fieldsOf(marker) });
    return true;
  } catch {
    return false;
  } finally {
    render();
  }
}

// The map's own focusable element for marker `id`.
export const markerButton = (id: string) =>
  document.querySelector<HTMLElement>(`#main [data-map-marker="${CSS.escape(id)}"]`);

// Focuses marker `id` once the page has drawn it, as Save and Undo leave it.
export async function focusMarker(id: string) {
  await nextTick();
  markerButton(id)?.focus();
}

// Deletes marker `id` with an Undo in the toast. Focus is the caller's: the map box, which a
// second Delete cannot remove anything from (#1255).
export async function deleteMarker(id: string): Promise<boolean> {
  const marker = state.mapMarkers?.find(entry => entry.id === id);
  if (!marker) return false;
  const profile = profileScope();
  try {
    await save({ type: 'mapMarker', id, value: null });
  } catch {
    render();
    return false;
  }
  render();
  toast(markerDeletedNews(marker.name), false, {
    label: 'Undo',
    run: () => void undoDelete(marker, profile),
  });
  return true;
}

// Undo, from the toast: puts the marker back as it was (after the others), only on the profile
// it was deleted from and only while no marker has its id again.
async function undoDelete(marker: MapMarker, profile: ProfileScope) {
  if (!onProfile(profile) || state.mapMarkers?.some(entry => entry.id === marker.id)) return;
  if (!(await saveMarker(marker))) return;
  toast(markerRestoredNews(marker.name));
  await focusMarker(marker.id);
}
