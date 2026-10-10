// The Docker edition's workspace file, the replies the interface reads, the item catalog and
// the two export formats. The browser edition (browser-api.ts) answers the same /api/ paths
// with the same shapes from IndexedDB.
import type { Choice, ItemRates, Phase, StageKey } from './common.ts';
import type { AlternateRanking, StoredCalculatedPlan, StoredSettings } from './calculated.ts';
import type { Handbook } from './legacy-handbook.ts';
import type { ProgressState, SavedState } from './state.ts';

// Every profile the planner makes, keeps after its migrations and exports is calculated.
export type ProfileKind = 'calculated';
// What a stored or imported profile may say. 'original', the retired handbook profile (#387,
// #397), is only read: from data saved before its migration (an old workspace.json or
// progress.json, an IndexedDB record, a full export), which the stores and imports convert into
// a calculated profile (migrateOriginalProfile in public/handbook-migration.ts). Nothing writes it.
export type StoredProfileKind = ProfileKind | 'original';

// A profile as stored: a calculated profile with its frozen plan. An original profile not
// migrated yet has no plan and may carry its own handbook, the migration's input.
export interface StoredProfile {
  id: string;
  name: string;
  kind: StoredProfileKind;
  plan?: StoredCalculatedPlan | null;
  handbook?: Handbook;
  state: SavedState;
  // The last hard-drive payoff ranking (#203). Derived, not progress: left out of exports and
  // shares, and only shown while planCreatedAt matches the plan it was ranked against.
  payoff?: StoredPayoff;
  // The id of the profile this one is a kept previous version of (#1071): set on the version a
  // recalculation in place keeps, and on the version a restore replaces, so "Restore this
  // version" can swap it back (public/state/restore.ts). Absent from every other profile and from
  // every profile stored before it; older releases keep it without reading it.
  backupOf?: string;
}

// POST /api/rank-alternates: rankAlternates (planner.ts) on the profile's plan settings, with
// the createdAt of the plan it compared against.
export interface StoredPayoff {
  planCreatedAt: string;
  // When it was ranked; missing from one stored by the first release of the route.
  rankedAt?: string;
  ranking: AlternateRanking;
}

export interface StoredSave {
  id: string;
  name: string;
  // The owning user's id ('owner' or a random id).
  userId: string;
  activeProfile: string;
  profiles: StoredProfile[];
}

export interface StoredUser {
  id: string;
  username: string;
  // 'salt:scryptHex'; the owner has none until accounts are set up.
  password?: string;
  // null for a new account until it creates its first save.
  activeSave: string | null;
}

// A save in the browser edition's record: no owner, since the browser is the only user.
export interface BrowserSave {
  id: string;
  name: string;
  activeProfile: string;
  profiles: StoredProfile[];
}

// The browser edition's IndexedDB record (browser-store.ts, store 'workspace', key 'main').
export interface BrowserWorkspace {
  version: 1;
  activeSave: string | null;
  saves: BrowserSave[];
  // The time of the last full export, for the Backup page and ADA.
  lastBackup: string | null;
}

// DATA_DIR/workspace.json (workspace.ts openWorkspace).
export interface WorkspaceFile {
  version: 2;
  revision: number;
  accountsEnabled: boolean;
  registration: boolean;
  users: StoredUser[];
  saves: StoredSave[];
  // A signed-in browser: the sha256 of its cookie token.
  sessions: { hash: string; userId: string; expires: number }[];
}

// A recipe as the wizard's recipe picker lists it.
export interface CatalogRecipe {
  id: string;
  name: string;
  phase: number;
  machine: string;
  inputs: ItemRates;
  outputs: ItemRates;
  // A MAM research alternate, and one of the pure ingot alternates.
  mam?: boolean;
  pure?: boolean;
  // An alternate a HUB milestone unlocks, not a hard drive: the milestone's tier (#1044).
  milestone?: number;
}

// planner.ts catalog(): the choices and defaults the wizard offers.
export interface Catalog {
  engine: string;
  alternates: CatalogRecipe[];
  standardRecipes: CatalogRecipe[];
  storageOptions: Choice[];
  supplyItems: string[];
  // What a storage container can hold, offered when one is added (#295): every item but fluids.
  containerItems: string[];
  // Items that can get a protected storage rate: needed to build, or delivered.
  storageItems: { name: string; build: boolean; delivered: boolean }[];
  distributions: Choice[];
  purities: Choice[];
  powerOptions: Choice[];
  sloopUses: Choice[];
  raw: string[];
  limits: ItemRates;
  pureLimits: ItemRates;
  goals: { id: string; name: string; description: string }[];
  // Vehicle transport on factory-group links (#205): items per inventory slot, the packaged
  // item a fluid travels as (with the m³ one item holds), and the fuels a vehicle can burn with their MJ per item.
  stacks: ItemRates;
  packaged: Record<string, { item: string; m3: number }>;
  vehicleFuels: { name: string; mj: number }[];
}

// A profile in the save list: its settings and tick count instead of the full state.
export interface ProfileSummary {
  id: string;
  name: string;
  kind: StoredProfileKind;
  settings?: StoredSettings;
  // The plan is a transcribed handbook (#486), so re-solving it warns first (#480).
  transcribed?: true;
  completed: number;
  phase: Phase;
  // The profile of the same save this one is a kept version of (restoreTarget, #1071): only set
  // while that profile exists, so only such a card offers "Restore this version".
  backupOf?: string;
  // The createdAt of the profile's plan, which a restore names (the stale-tab guard, #1071).
  planCreatedAt?: string;
  // A calculated profile's progress per phase it offers (SP-32): the milestone-only phases before
  // its start phase (#783, only with `steps`), then each phase from the start phase. The
  // production lines ticked Running over the phase's lines, and its build-plan steps ticked
  // (`steps`, #746). Absent without a calculated plan.
  phases?: PhaseProgress[];
}

// One phase of ProfileSummary.phases: `done`/`total` are its production lines ticked Running (0
// of 0 for a milestone-only phase before the start phase, #759, #783).
export interface PhaseProgress {
  phase: StageKey;
  done: number;
  total: number;
  // The phase's build-plan steps (planStepIds in public/state/summary.ts) ticked, over all of
  // them (#746). Absent where the summary had no progression.json, in replies before #746, and
  // for a phase after the one the profile works on, which the card draws empty (#804).
  steps?: { done: number; total: number };
}

export interface SaveSummary {
  id: string;
  name: string;
  activeProfile: string;
  profiles: ProfileSummary[];
}

// GET /api/workspace: the signed-in user's saves. user is null when signed out. The browser
// edition (browser-api.ts) sends browser: true and lastBackup, the time of the last full
// export, and has no registration or owner flag.
export interface WorkspaceSummary {
  browser?: true;
  lastBackup?: string | null;
  accountsEnabled: boolean;
  registration?: boolean;
  user: { id: string; username: string; owner?: boolean } | null;
  activeSave?: string | null;
  catalog: Catalog;
  saves: SaveSummary[];
}

// GET /api/context: the scoped save and profile, with everything the pages read.
export interface ContextReply {
  save: { id: string; name: string };
  profile: { id: string; name: string; kind: StoredProfileKind };
  state: ProgressState;
  plan: StoredCalculatedPlan | null;
  // The stored ranking while it still matches the plan, otherwise null.
  payoff?: StoredPayoff | null;
}

// GET /api/export: one profile's progress, restored with /api/import (which also takes a
// bare state). The names only label the file.
export interface ProgressBackup {
  format: 'satisfactory-planner-backup';
  exportedAt: string;
  saveName?: string;
  profileName?: string;
  profileId?: string;
  state: SavedState;
}

// A full-save export (public/transfer.ts): saves with their profiles, never accounts. Every
// profile in it is calculated.
export interface SaveExport {
  format: 'satisfactory-planner-saves';
  version: 1;
  exportedAt?: string;
  saves: {
    id: string;
    name: string;
    activeProfile: string;
    profiles: {
      id: string;
      name: string;
      kind: ProfileKind;
      plan: StoredCalculatedPlan | null;
      state: SavedState;
      // The kept-version link (StoredProfile.backupOf), only to a profile of the same save.
      backupOf?: string;
    }[];
  }[];
}

// Any full-save export a release wrote, as validateTransfer accepts it: one from before the
// handbook was retired may hold an original profile with its own handbook, which
// importableTransfer converts into a calculated profile (#387, #605).
type ExportedSave = SaveExport['saves'][number];
export interface ImportableSaveExport extends Omit<SaveExport, 'saves'> {
  saves: (Omit<ExportedSave, 'profiles'> & {
    profiles: (Omit<ExportedSave['profiles'][number], 'kind'> & {
      kind: StoredProfileKind;
      handbook?: Handbook;
    })[];
  })[];
}
