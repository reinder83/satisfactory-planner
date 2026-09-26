// The Docker edition's workspace file, the replies the interface reads, the item catalog and
// the two export formats. The browser edition (browser-api.ts) answers the same /api/ paths
// with the same shapes from IndexedDB.
import type { Choice, ItemRates, Phase } from './common.ts';
import type { AlternateRanking, StoredCalculatedPlan, StoredSettings } from './calculated.ts';
import type { Handbook } from './handbook.ts';
import type { ProgressState, SavedState } from './state.ts';

export type ProfileKind = 'original' | 'calculated';

// A profile as stored. The original handbook profile has no plan and may carry its own
// handbook; a calculated profile carries its frozen plan.
export interface StoredProfile {
  id: string;
  name: string;
  kind: ProfileKind;
  plan?: StoredCalculatedPlan | null;
  handbook?: Handbook;
  state: SavedState;
  // The last hard-drive payoff ranking (#203). Derived, not progress: left out of exports and
  // shares, and only shown while planCreatedAt matches the plan it was ranked against.
  payoff?: StoredPayoff;
}

// POST /api/rank-alternates: rankAlternates (planner.ts) on the profile's plan settings, with
// the createdAt of the plan it compared against.
export interface StoredPayoff {
  planCreatedAt: string;
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
}

// planner.ts catalog(): the choices and defaults the wizard offers.
export interface Catalog {
  engine: string;
  alternates: CatalogRecipe[];
  standardRecipes: CatalogRecipe[];
  storageOptions: Choice[];
  supplyItems: string[];
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
  kind: ProfileKind;
  settings?: StoredSettings;
  completed: number;
  phase: Phase;
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
  profile: { id: string; name: string; kind: ProfileKind };
  state: ProgressState;
  plan: StoredCalculatedPlan | null;
  handbook?: Handbook;
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

// A full-save export (public/transfer.ts): saves with their profiles, never accounts.
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
      handbook?: Handbook;
      state: SavedState;
    }[];
  }[];
}
