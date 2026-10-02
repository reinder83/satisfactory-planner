// Saved data of every released shape, typed with public/types/. The type check proves the
// types accept them (npm run typecheck); tests/data-types.test.ts proves validateState and
// validateTransfer accept them too, so the types and the run-time gate agree.
import type { ProgressBackup, SaveExport, SavedState } from '../../public/types/index.ts';
import firstPlan from '../fixtures/calculated-plan-2026-09-12.json' with { type: 'json' };

// The first release's initial state (2026-09-12): no layout, step edits or groups.
export const version1 = {
  version: 1,
  revision: 0,
  checks: { 'storage-ground-shell': true },
  notes: {},
  deliveries: { '3-versatile-framework': 125000 },
  settings: { phase: '3' },
  customTasks: [],
} satisfies SavedState;

// A progress.json from before the revision counter, with a personal task and notes.
export const version1NoRevision = {
  version: 1,
  checks: { 'phase-3-iron': true, 'custom-1': false },
  notes: { global: 'Seed 1234', 'factory-wire': 'By the river' },
  deliveries: {},
  settings: { phase: 'post' },
  customTasks: [{ id: 'custom-1', title: 'Build a train station', phase: '4' }],
} satisfies SavedState;

// Version 2: storage layout edits, some sections left out.
export const version2 = {
  version: 2,
  revision: 7,
  checks: { 'slot-A01-built': true },
  notes: { 'slot-A01': 'Top shelf' },
  deliveries: {},
  settings: { phase: '4' },
  customTasks: [],
  storageEdits: {
    floors: [{ id: 'cf-roof1', label: 'Roof' }],
    bays: [{ id: 'S', name: 'Spare parts', floor: 'cf-roof1' }],
    slots: { S01: 'Screws' },
    clearedSlots: ['A02'],
  },
} satisfies SavedState;

// Version 3: build-plan edits and factory groups.
export const version3 = {
  version: 3,
  revision: 12,
  checks: {},
  notes: {},
  deliveries: {},
  settings: { phase: '3' },
  customTasks: [],
  taskEdits: {
    order: { '3': ['phase-3-iron', 'phase-3-survey'] },
    removed: ['phase-3-retire-power'],
    titles: { 'phase-3-iron': 'Iron first' },
    bodies: {},
    links: { 'phase-3-iron': 'iron-plate' },
  },
  factoryGroups: {
    groups: [{ id: 'fg-plates1', name: 'Plates' }],
    assignments: { 'iron-plate': [{ group: 'fg-plates1', rate: null }] },
  },
} satisfies SavedState;

// Version 4: a container position past 08.
export const version4 = {
  version: 4,
  revision: 3,
  checks: { 'slot-A09-built': true },
  notes: {},
  deliveries: {},
  settings: { phase: '5' },
  customTasks: [],
  storageEdits: {
    floors: [],
    floorNames: {},
    bays: [],
    bayNames: {},
    slots: { A09: 'Quickwire' },
    clearedSlots: [],
  },
  taskEdits: { order: {}, removed: [], titles: {}, bodies: {}, links: {} },
  factoryGroups: { groups: [], assignments: {} },
} satisfies SavedState;

// Version 5: a hidden handbook bay (#166), its records kept.
export const version5 = {
  ...version4,
  version: 5,
  checks: { 'slot-C01-built': true },
  notes: { 'slot-C01': 'Behind the lift' },
  storageEdits: { ...version4.storageEdits, hiddenBays: ['C'] },
} satisfies SavedState;

// Version 6: a hidden built-in floor (#168).
export const version6 = {
  ...version5,
  version: 6,
  storageEdits: { ...version5.storageEdits, hiddenFloors: ['workshop'] },
} satisfies SavedState;

// Version 7: a vehicle picked for a factory-group link (#205).
export const version7 = {
  ...version6,
  version: 7,
  factoryGroups: {
    groups: [{ id: 'fg-plates1', name: 'Plates' }],
    assignments: {},
    links: {
      'fg-plates1:elevator': { mode: 'truck', roundTripMin: 4, fuel: 'Packaged Fuel' },
      'mines:fg-plates1': { mode: 'train', roundTripMin: 12 },
    },
  },
} satisfies SavedState;

// Version 8: a handbook bay moved to another floor (#190), its records kept.
export const version8 = {
  ...version7,
  version: 8,
  storageEdits: { ...version7.storageEdits, bayFloors: { D: 'upper' } },
} satisfies SavedState;

// Version 9: a factory-group link to the vehicle fuel place (#206, #220).
export const version9 = {
  ...version8,
  version: 9,
  factoryGroups: {
    ...version8.factoryGroups,
    links: {
      ...version8.factoryGroups.links,
      'fg-plates1:vehicles': { mode: 'tractor', roundTripMin: 3, fuel: 'Packaged Fuel' },
    },
  },
} satisfies SavedState;

// Version 10: the bays on a floor put in their own order (#191).
export const version10 = {
  ...version9,
  version: 10,
  storageEdits: { ...version9.storageEdits, bayOrder: { ground: ['B', 'A', 'C'] } },
} satisfies SavedState;

// Version 11: a link from one raw resource as a source of its own (#231).
export const version11 = {
  ...version10,
  version: 11,
  factoryGroups: {
    ...version10.factoryGroups,
    links: {
      ...version10.factoryGroups.links,
      'supply/Iron Ore:fg-plates1': { mode: 'train', roundTripMin: 6 },
    },
  },
} satisfies SavedState;

// Version 12: a profile migrated from the handbook (#387, #485), with what the migration could
// not place kept for review.
export const version12 = {
  ...version11,
  version: 12,
  handbookOrigin: {
    version: '2026-09-13',
    unmapped: {
      checks: { 'factory-3-plastic': true, 'factory-3-rubber': false },
      notes: { 'factory-old-campus': 'Moved the campus east' },
      assignments: { 'old-campus': [{ group: 'fg-plates1', rate: null }] },
    },
  },
} satisfies SavedState;

// Version 13: a migrated profile that also records what its migration mapped (#606), so a
// progress backup made before the migration can be re-keyed onto it later.
export const version13 = {
  ...version12,
  version: 13,
  handbookOrigin: {
    ...version12.handbookOrigin,
    mapping: {
      rows: {
        '3': { 'iron-plate': 'Recipe_IronPlate_C', 'iron-rod': 'Recipe_IronRod_C' },
        '4': { 'iron-plate': 'Recipe_IronPlate_C' },
        '5': {},
      },
      factories: ['iron-plate', 'iron-rod', 'plastic'],
      knownChecks: { 'storage-ground-shell': true },
      deliveries: { '3-versatile-framework': 125000 },
    },
  },
} satisfies SavedState;

// Each state and the version validateState must mark it with.
export const states: [SavedState, number][] = [
  [version1, 1],
  [version1NoRevision, 1],
  [version2, 2],
  [version3, 3],
  [version4, 4],
  [version5, 5],
  [version6, 6],
  [version7, 7],
  [version8, 8],
  [version9, 9],
  [version10, 10],
  [version11, 11],
  [version12, 12],
  [version13, 13],
];

export const backup = {
  format: 'satisfactory-planner-backup',
  exportedAt: '2026-09-20T10:00:00.000Z',
  saveName: 'My Satisfactory save',
  profileName: 'Original',
  profileId: 'original',
  state: version2,
} satisfies ProgressBackup;

// A full-save export holding the oldest calculated plan any save can have: one frozen by
// the first release's planner (tests/fixtures/calculated-plan-2026-09-12.json). The JSON
// import widens its string fields, which data.types.ts checks against the plan types
// separately; here it is only carried.
export const saveExport: SaveExport = {
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-09-25T12:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'Old world',
      activeProfile: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'First calculation',
          kind: 'calculated',
          // The one double cast: a JSON import widens string unions ('3') to string, so the
          // file's type never matches StoredCalculatedPlan. data.types.ts checks this same
          // file against that type (Loose) and for undeclared fields instead.
          plan: firstPlan as unknown as SaveExport['saves'][number]['profiles'][number]['plan'],
          state: version1,
        },
      ],
    },
  ],
};
