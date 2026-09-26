import { validateState } from './state.ts';
import type { Handbook, ProfileKind, SaveExport, StoredCalculatedPlan } from './types/index.ts';

// An export as it arrives, with only the fields read here, none of them checked yet.
interface IncomingProfile {
  id: unknown;
  name: unknown;
  kind: unknown;
  plan?: {
    settings?: unknown;
    stages?: Record<string, { rows?: unknown; feasible?: unknown } | undefined>;
    warnings?: unknown;
  };
  handbook?: {
    factories?: unknown;
    phases?: unknown;
    storage?: unknown;
    sources?: { url: string }[];
  };
  state: unknown;
}
interface IncomingSave {
  id: unknown;
  name: unknown;
  activeProfile: unknown;
  profiles: unknown;
}
// Full-save export: a user's saves with their profiles, plans or handbooks and progress,
// never accounts, passwords or sessions. Written by /api/export-saves in workspace.ts and
// browser-api.ts and read back by their /api/import-saves, so saves move between editions.
//   { format, version: 1, exportedAt, saves: [{ id, name, activeProfile, profiles: [
//     { id, name, kind: 'calculated' | 'original', plan, handbook?, state }] }] }
// The ids only keep activeProfile pointing at the right profile: both importers give every
// save and profile a new id, so an import always adds copies and never overwrites.
export const transferFormat = 'satisfactory-planner-saves';
// Save and profile names are checked but kept exactly as exported, untrimmed.
const title = (x: unknown): string => {
  if (typeof x !== 'string' || !x.trim() || x.length > 80)
    throw Error('Invalid save or profile name.');
  return x;
};
// Checks a parsed export and returns a clean copy of the same shape, without exportedAt.
// Throws plain Errors before anything is written. Each profile's progress goes through
// validateState, so older state versions import and a state from a newer planner is refused
// with its update message. Only version 1 of this wrapper exists. Plans and handbooks are
// checked for shape only and otherwise copied as they are.
// Every field kept is checked or validated on the way out; plans and handbooks are checked for
// shape only, as above, and then treated as the stored types.
export function validateTransfer(data: unknown): Omit<SaveExport, 'exportedAt'> {
  const d = data as Record<string, unknown> | null | undefined;
  if (
    d?.format !== transferFormat ||
    d.version !== 1 ||
    !Array.isArray(d.saves) ||
    d.saves.length > 50
  )
    throw Error('Choose a full planner save export.');
  // Only accept data objects; executable links never belong in a portable handbook.
  const text = JSON.stringify(data);
  if (text.length > 50 * 1024 * 1024 || /"(?:__proto__|constructor|prototype)"\s*:/.test(text))
    throw Error('Invalid or oversized save export.');
  const saves = (d.saves as IncomingSave[]).map(s => {
    if (!Array.isArray(s.profiles) || !s.profiles.length || s.profiles.length > 30)
      throw Error('Invalid profiles in export.');
    const profiles = (s.profiles as IncomingProfile[]).map(p => {
      if (!['calculated', 'original'].includes(p.kind as string) || typeof p.id !== 'string')
        throw Error('Invalid profile.');
      const kind = p.kind as ProfileKind;
      // A calculated profile must bring its calculation snapshot, since profiles are never
      // silently recalculated, with a stage for each of phases 1–5. An original profile must
      // bring its own handbook rather than fall back to the current default.
      if (kind === 'calculated') {
        if (!p.plan?.settings || !p.plan?.stages || !Array.isArray(p.plan.warnings))
          throw Error('Missing calculation snapshot.');
        for (const phase of ['1', '2', '3', '4', '5']) {
          const stage = p.plan.stages[phase];
          if (!stage || !Array.isArray(stage.rows || []) || typeof stage.feasible !== 'boolean')
            throw Error('Invalid calculation stage.');
        }
      } else if (!p.handbook?.factories || !p.handbook?.phases || !p.handbook?.storage)
        throw Error('This original profile needs its full handbook export.');
      // Handbook source links survive only as https URLs.
      const handbook = kind === 'original' ? structuredClone(p.handbook) : undefined;
      if (handbook)
        handbook.sources = (handbook.sources || []).filter(s => {
          try {
            return new URL(s.url).protocol === 'https:';
          } catch {
            return false;
          }
        });
      return {
        id: p.id,
        name: title(p.name),
        kind,
        plan: kind === 'calculated' ? (structuredClone(p.plan) as StoredCalculatedPlan) : null,
        ...(handbook ? { handbook: handbook as Handbook } : {}),
        state: validateState(p.state),
      };
    });
    if (
      new Set(profiles.map(p => p.id)).size !== profiles.length ||
      !profiles.some(p => p.id === s.activeProfile)
    )
      throw Error('Invalid active profile.');
    // The check above matched it against the (string) profile ids.
    return {
      id: String(s.id),
      name: title(s.name),
      activeProfile: s.activeProfile as string,
      profiles,
    };
  });
  return { format: transferFormat, version: 1, saves };
}
