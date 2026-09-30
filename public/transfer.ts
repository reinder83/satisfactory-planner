import { safeKey, validateState } from './state.ts';
import {
  migrateOriginalProfile,
  usableHandbook,
  type MigrationData,
} from './handbook-migration.ts';
import type {
  Handbook,
  PlanGuide,
  ProfileKind,
  SaveExport,
  StoredCalculatedPlan,
} from './types/index.ts';

// An export as it arrives, with only the fields read here, none of them checked yet.
interface IncomingProfile {
  id: unknown;
  name: unknown;
  kind: unknown;
  plan?: {
    settings?: unknown;
    stages?: Record<string, { rows?: unknown; feasible?: unknown } | undefined>;
    warnings?: unknown;
    guide?: unknown;
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
// The largest full-save file an import accepts (validateTransfer, the Backup page and the
// server's body limit in server.ts all use 50 MB).
export const transferImportLimit = 50 * 1024 * 1024;
// The size in bytes of an export as downloadJson (app/api.ts) writes it.
export const transferFileSize = (data: unknown) => new Blob([JSON.stringify(data, null, 2)]).size;
// A refused export. The status makes the server answer 400 with this message, like state.ts's
// fail; the browser edition shows the message either way.
function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
// Save and profile names are checked but kept exactly as exported, untrimmed.
const title = (name: unknown): string => {
  if (typeof name !== 'string' || !name.trim() || name.length > 80)
    invalid('Invalid save or profile name.');
  return name;
};
const record = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
// record() as a type guard, for a value whose fields are read next.
const fields = (value: unknown): value is Record<string, unknown> => record(value);
// Only https links survive, in a handbook's or a plan guide's sources.
const httpsOnly = <T extends { url: string }>(sources: T[]) =>
  sources.filter(source => {
    try {
      return new URL(source.url).protocol === 'https:';
    } catch {
      return false;
    }
  });
// A calculated plan's optional guide (#393, #466): its shape is checked, since pages render it,
// and its source links keep only https ones. Returns a clean copy, or throws.
function checkGuide(input: unknown): PlanGuide {
  // Typed on the name, so a check followed by bad() narrows what comes after it.
  const bad: () => never = () => invalid('Invalid plan guide.');
  const text = (value: unknown): value is string => typeof value === 'string';
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  const rates = (value: unknown) => record(value) && Object.values(value as object).every(finite);
  // Every id a guide gives is a saved check key: it must pass state.ts's key rule and be unique
  // across the guide, or its step could never be ticked, or would tick with its twin (#471).
  const ids = new Set<string>();
  const id = (value: unknown) => {
    if (!safeKey(value) || ids.has(value)) bad();
    ids.add(value as string);
  };
  const steps = (list: unknown) => {
    if (!Array.isArray(list)) bad();
    for (const step of list as GuideShape[]) {
      if (!record(step) || !text(step.title) || !text(step.body)) bad();
      id(step.id);
    }
  };
  if (!record(input)) bad();
  const guide = structuredClone(input) as PlanGuide & Record<string, unknown>;
  if (!record(guide.phases)) bad();
  Object.values(guide.phases).forEach(steps);
  if (guide.storageTasks !== undefined) steps(guide.storageTasks);
  if (guide.completion !== undefined) {
    if (!Array.isArray(guide.completion)) bad();
    const completion: unknown[] = guide.completion;
    for (const module of completion) {
      if (
        !fields(module) ||
        ![module.id, module.name, module.recipe, module.machine].every(text) ||
        ![module.output, module.machines, module.lastClock].every(finite) ||
        !rates(module.inputs) ||
        !rates(module.byproducts)
      )
        bad();
      // A module is ticked as completion-<id> (#468), so that key is held to the same rule (#477).
      id('completion-' + module.id);
    }
  }
  if (guide.power !== undefined) {
    const power: unknown = guide.power;
    if (!fields(power) || !Array.isArray(power.checks) || !Array.isArray(power.blocks)) bad();
    for (const check of power.checks as Record<string, unknown>[]) {
      if (!record(check) || !text(check.label)) bad();
      id(check.id);
    }
    if (
      !(power.blocks as unknown[]).every(
        block =>
          record(block) && text((block as GuideShape).title) && text((block as GuideShape).body),
      )
    )
      bad();
  }
  if (guide.factories !== undefined) {
    if (!record(guide.factories)) bad();
    for (const [row, factory] of Object.entries(
      guide.factories as Record<string, Record<string, unknown>>,
    ))
      if (
        !safeKey(row) ||
        !record(factory) ||
        (factory.note !== undefined && !text(factory.note)) ||
        (factory.page !== undefined && !finite(factory.page)) ||
        (factory.local !== undefined && typeof factory.local !== 'boolean') ||
        (factory.nuclear !== undefined && typeof factory.nuclear !== 'boolean') ||
        (factory.site !== undefined && factory.site !== 'oil' && factory.site !== 'nuclear')
      )
        bad();
  }
  if (guide.sources !== undefined) {
    if (
      !Array.isArray(guide.sources) ||
      !guide.sources.every(source => record(source) && text(source.url))
    )
      bad();
    guide.sources = httpsOnly(guide.sources);
  }
  return guide;
}
type GuideShape = { id?: unknown; title?: unknown; body?: unknown };
// Checks a parsed export and returns a clean copy of the same shape, without exportedAt.
// Throws (invalid(): an Error with status 400) before anything is written. Each profile's progress goes through
// validateState, so older state versions import and a state from a newer planner is refused
// with its update message. Only version 1 of this wrapper exists. Plans and handbooks are
// checked for shape only and otherwise copied as they are.
// Every field kept is checked or validated on the way out; plans and handbooks are checked for
// shape only, as above, and then treated as the stored types.
export function validateTransfer(data: unknown): Omit<SaveExport, 'exportedAt'> {
  const input = data as Record<string, unknown> | null | undefined;
  if (
    input?.format !== transferFormat ||
    input.version !== 1 ||
    !Array.isArray(input.saves) ||
    input.saves.length > 50
  )
    invalid('Choose a full planner save export.');
  // Only accept data objects; executable links never belong in a portable handbook.
  const text = JSON.stringify(data);
  if (text.length > transferImportLimit || /"(?:__proto__|constructor|prototype)"\s*:/.test(text))
    invalid('Invalid or oversized save export.');
  const saves = (input.saves as IncomingSave[]).map(save => {
    if (
      !record(save) ||
      !Array.isArray(save.profiles) ||
      !save.profiles.length ||
      save.profiles.length > 30
    )
      invalid('Invalid profiles in export.');
    const profiles = (save.profiles as IncomingProfile[]).map(profile => {
      if (
        !record(profile) ||
        !['calculated', 'original'].includes(profile.kind as string) ||
        typeof profile.id !== 'string'
      )
        invalid('Invalid profile.');
      const kind = profile.kind as ProfileKind;
      // A calculated profile must bring its calculation snapshot, since profiles are never
      // silently recalculated, with a stage for each of phases 1–5. An original profile must
      // bring its own handbook rather than fall back to the current default.
      if (kind === 'calculated') {
        if (
          !profile.plan?.settings ||
          !profile.plan?.stages ||
          !Array.isArray(profile.plan.warnings)
        )
          invalid('Missing calculation snapshot.');
        for (const phase of ['1', '2', '3', '4', '5']) {
          const stage = profile.plan.stages[phase];
          if (!stage || !Array.isArray(stage.rows || []) || typeof stage.feasible !== 'boolean')
            invalid('Invalid calculation stage.');
        }
      } else if (
        !profile.handbook?.factories ||
        !profile.handbook?.phases ||
        !profile.handbook?.storage
      )
        invalid(
          'This save file comes from an older planner and is incomplete, so it cannot be imported. Export it again from the planner that made it.',
        );
      // Handbook source links survive only as https URLs.
      const handbook = kind === 'original' ? structuredClone(profile.handbook) : undefined;
      if (handbook && handbook.sources !== undefined && !Array.isArray(handbook.sources))
        invalid(
          'This save file has damaged source links, so it cannot be imported. Export it again from the planner that made it.',
        );
      // Every part the conversion reads must be there and of its shape (#609). The stores convert
      // such a profile with what they can read, keeping their pre-migration copy; an import is
      // refused instead, since the file is the user's own copy. Every release exported a whole
      // handbook, so only a hand-made or damaged file is refused.
      if (kind === 'original' && !usableHandbook(profile.handbook).complete)
        invalid(
          'This save file comes from an older planner and is incomplete or damaged, so it cannot be imported. Export it again from the planner that made it.',
        );
      if (handbook) handbook.sources = httpsOnly(handbook.sources || []);
      const plan =
        kind === 'calculated' ? (structuredClone(profile.plan) as StoredCalculatedPlan) : null;
      if (plan && profile.plan!.guide !== undefined) plan.guide = checkGuide(profile.plan!.guide);
      return {
        id: profile.id,
        name: title(profile.name),
        kind,
        plan,
        ...(handbook ? { handbook: handbook as Handbook } : {}),
        state: validateState(profile.state),
      };
    });
    if (
      new Set(profiles.map(p => p.id)).size !== profiles.length ||
      !profiles.some(p => p.id === save.activeProfile)
    )
      invalid('Invalid active profile.');
    // The check above matched it against the (string) profile ids.
    return {
      id: String(save.id),
      name: title(save.name),
      activeProfile: save.activeProfile as string,
      profiles,
    };
  });
  return { format: transferFormat, version: 1, saves };
}

// What /api/import-saves stores, in both editions: the export checked by validateTransfer, with
// every original profile converted into a calculated one with its own handbook (#387, #605),
// the same conversion the stores run on the profiles they already hold (migrateOriginalProfile).
// Every record is kept, re-keyed or kept for review in handbookOrigin.unmapped; calculated
// profiles, an already migrated export's among them, are left exactly as validateTransfer
// returns them. `load` (the recipes and the catalog's pure-node limits) is only called when there
// is an original profile to convert; without it (tests of other behaviour) none is. The imported
// file is the user's own copy of the unconverted data. Throws before anything is written, like
// validateTransfer.
export async function importableTransfer(
  data: unknown,
  load?: () => Promise<MigrationData>,
): Promise<Omit<SaveExport, 'exportedAt'>> {
  const transfer = validateTransfer(data);
  const original = transfer.saves.some(save => save.profiles.some(p => p.kind === 'original'));
  if (!load || !original) return transfer;
  const { recipes, pureLimits } = await load();
  for (const save of transfer.saves)
    save.profiles = save.profiles.map(profile => {
      if (profile.kind !== 'original') return profile;
      try {
        // validateTransfer requires an original profile to carry its own handbook.
        return migrateOriginalProfile(profile, profile.handbook!, recipes, pureLimits);
      } catch {
        // A last guard: validateTransfer already refused a handbook the conversion cannot read
        // (#609).
        return invalid(
          'This save file comes from an older planner and could not be converted, so it cannot be imported. Export it again from the planner that made it.',
        );
      }
    });
  return transfer;
}
