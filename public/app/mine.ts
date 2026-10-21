// "Mine only" (#1199, co-op slice 2 of #1077): who "me" is on this device, and the filter that
// shows only the factories owned by "me" and their production lines, on the Factories page and in
// the build plan. Both are view preferences remembered in this browser, like "Hide completed"
// (session.ts), never in a saved profile: nothing stored changes and nothing is recalculated. The
// owners themselves are saved with the factory groups (groups[].owner, state version 20).
//
// The rule for factories without an owner: "Mine only" hides them, as it hides the factories of
// others and the lines in no factory. "Mine" is what carries your name; a factory nobody owns is
// nobody's yet, so it shows again once you put your name on it or untick "Mine only".
//
// The filter applies only while it can mean something: it is on, a name is set, and at least one
// factory of the open profile has an owner (else the switch is not drawn). While the factories are
// being edited it is paused, so every factory shows and can get its owner.
import { OWNER_MAX } from '../state.ts';
import type { FactoryGroups } from '../types/index.ts';

export const ME_KEY = 'planner-me';
export const MINE_ONLY_KEY = 'planner-mine-only';

let me = storedMe();
let mineOnly = storedMineOnly();

function storedMe(): string {
  try {
    return (localStorage.getItem(ME_KEY) || '').trim().slice(0, OWNER_MAX);
  } catch {
    return '';
  }
}
function storedMineOnly(): boolean {
  try {
    return localStorage.getItem(MINE_ONLY_KEY) === 'on';
  } catch {
    return false;
  }
}

// The name this device's player goes by, '' for none set.
export const meName = (): string => me;
export const mineOnlyOn = (): boolean => mineOnly;

// Remembers the name, trimmed; a blank one forgets it.
export function setMeName(value: string) {
  me = value.trim().slice(0, OWNER_MAX);
  try {
    if (me) localStorage.setItem(ME_KEY, me);
    else localStorage.removeItem(ME_KEY);
  } catch {}
}
export function setMineOnly(value: boolean) {
  mineOnly = value;
  try {
    localStorage.setItem(MINE_ONLY_KEY, value ? 'on' : 'off');
  } catch {}
}
// Reads both again from storage: for the tests, which change it under a loaded module.
export function reloadMine() {
  me = storedMe();
  mineOnly = storedMineOnly();
}

// Whether owner name `owner` is `name`: the same once trimmed, whatever the case ("anna" is Anna).
export const sameOwner = (owner: string | undefined, name: string): boolean =>
  !!owner && !!name.trim() && owner.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase();

// Whether any group of `groups` has an owner, so the "Mine only" switch has something to compare.
export const anyOwner = (groups: FactoryGroups): boolean => groups.groups.some(g => g.owner);

// The ids of the groups owned by `name`.
export const ownedBy = (groups: FactoryGroups, name: string): Set<string> =>
  new Set(groups.groups.filter(g => sameOwner(g.owner, name)).map(g => g.id));

// The groups whose lines "Mine only" keeps, or null while it does not apply: it is off, no name is
// set, no group has an owner, or the factories are being edited.
export function mineFilter(groups: FactoryGroups, editing = false): Set<string> | null {
  if (!mineOnly || !me || editing || !anyOwner(groups)) return null;
  return ownedBy(groups, me);
}
