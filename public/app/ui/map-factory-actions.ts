// Placing, moving and taking factories off the world map (#1283, slice 3), from the map page
// ("Place factory", a drag, an arrow key, Delete). Each write is one `mapFactory` update through
// save(), so it reaches the profile it was made on and nothing else. Taking a factory off the map
// asks nothing: the toast says so with Undo (Ctrl+Z or ⌘Z too), as for a marker
// (map-marker-actions.ts), and Undo puts it back where it stood, only on the profile it was taken
// from and only while that factory is still there and not on the map again.
import { nextTick } from 'vue';
import { save, toast } from '../api.ts';
import { factoryRemovedNews, factoryRestoredNews } from '../map-factories.ts';
import { onProfile, profileScope, state, type ProfileScope } from '../session.ts';
import { render } from '../shell.ts';
import type { FactoryPlace } from '../../types/index.ts';

// Puts factory group `id` on the map at `place`, or moves it there. Resolves false when it was
// refused (save() has said why in a toast).
export async function saveFactoryPlace(id: string, place: FactoryPlace): Promise<boolean> {
  try {
    await save({ type: 'mapFactory', id, value: { x: place.x, y: place.y } });
    return true;
  } catch {
    return false;
  } finally {
    render();
  }
}

// The map's own focusable element for factory `id`.
export const mapFactoryLink = (id: string) =>
  document.querySelector<HTMLElement>(`#main [data-map-factory="${CSS.escape(id)}"]`);

// Focuses factory `id` on the map once the page has drawn it.
export async function focusFactory(id: string) {
  await nextTick();
  mapFactoryLink(id)?.focus();
}

// Takes factory `id` off the map with an Undo in the toast. Focus is the caller's: the map box,
// where a second Delete takes nothing off (#1255).
export async function removeFactoryPlace(id: string): Promise<boolean> {
  const place = state.factoryPlaces?.[id];
  const name = state.factoryGroups?.groups.find(group => group.id === id)?.name;
  if (!place || name === undefined) return false;
  const profile = profileScope();
  try {
    await save({ type: 'mapFactory', id, value: null });
  } catch {
    render();
    return false;
  }
  render();
  toast(factoryRemovedNews(name), false, {
    label: 'Undo',
    run: () => void undoRemove(id, name, place, profile),
  });
  return true;
}

// Undo, from the toast: the factory back where it stood.
async function undoRemove(id: string, name: string, place: FactoryPlace, profile: ProfileScope) {
  if (!onProfile(profile) || state.factoryPlaces?.[id]) return;
  if (!state.factoryGroups?.groups.some(group => group.id === id)) return;
  if (!(await saveFactoryPlace(id, place))) return;
  toast(factoryRestoredNews(name));
  await focusFactory(id);
}
