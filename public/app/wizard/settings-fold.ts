// Whether the settings form above the recipe picker on All settings step 2 is open (ONB-1,
// #1328). Folded by default, so the picker's search and groups start near the top of the page
// instead of under about 2,000 px of fields. A view preference remembered in this browser like
// "Hide completed" (session.ts), never in a saved profile: it changes what one page shows, not
// the plan, so it needs no state version. Nothing stored, or anything unreadable, means folded.
// Kept in memory as well, so the toggle still works where the browser refuses storage.
import { ref } from 'vue';
import { droneFuels, powerOptions, storageOptions } from '../../preferences.ts';

export const SETTINGS_FOLD_KEY = 'planner-recipe-settings-open';

function stored(): boolean {
  try {
    return localStorage.getItem(SETTINGS_FOLD_KEY) === 'on';
  } catch {
    return false;
  }
}

// Reactive, so the step redraws when it changes.
export const settingsOpen = ref(stored());

export function setSettingsOpen(value: boolean) {
  settingsOpen.value = value;
  try {
    localStorage.setItem(SETTINGS_FOLD_KEY, value ? 'on' : 'off');
  } catch {}
}

const RECIPES: Record<string, string> = {
  standard: 'Standard',
  all: 'All alternates',
  custom: 'Pick specific alternates',
};
const SAM: Record<string, string> = {
  avoid: 'avoid',
  needed: 'only when needed',
  allow: 'allow',
};
const NUCLEAR: Record<string, string> = {
  none: 'none',
  sink: 'sink plutonium rods',
  recycle: 'full recycling',
};
const labelOf = (options: readonly (readonly string[])[], value: string): string =>
  (options.find(([key]) => key === value)?.[1] ?? value).toLowerCase();

// The folded form's one line: the choices that shape the plan, in the order of the form. `get`
// reads a field by its name (the form's current value, or the draft's).
export function settingsSummary(get: (name: string) => string | undefined): string {
  const fuel = get('droneFuel') || 'none';
  const parts = [
    ['Recipe access', RECIPES[get('recipes') ?? ''] ?? get('recipes') ?? ''],
    ['Ingot lines', get('pureIngots') === 'true' ? 'pure required' : 'planner chooses'],
    ['SAM', SAM[get('sam') ?? ''] ?? get('sam') ?? ''],
    [
      'Power',
      get('mainPower') && get('mainPower') !== 'auto'
        ? labelOf(powerOptions, get('mainPower')!)
        : 'planner chooses',
    ],
    ['Nuclear', NUCLEAR[get('nuclear') ?? ''] ?? get('nuclear') ?? ''],
    ['Storage', labelOf(storageOptions, get('storage') ?? 'none')],
  ];
  if ((droneFuels as readonly string[]).includes(fuel) && fuel !== 'none')
    parts.push(['Drone fuel', fuel]);
  return parts.map(([name, value]) => `${name}: ${value}`).join(' · ');
}
