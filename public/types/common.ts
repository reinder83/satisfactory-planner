// Small shared types for the data files and API replies (see ./index.ts).

// A phase as the interface and saved progress name it: '1'–'5', then post-game.
export type Phase = '1' | '2' | '3' | '4' | '5' | 'post';

// A calculated plan's stage key: post-game reads Phase 5's stage (stage() in session.ts).
export type StageKey = '1' | '2' | '3' | '4' | '5';

// The handbook only covers Phases 3–5 (the original profile starts in Phase 3).
export type HandbookStageKey = '3' | '4' | '5';

// Per-minute quantities keyed by item name: { 'Iron Plate': 120 }.
export type ItemRates = Record<string, number>;

// A [value, label] choice, as the catalog lists options for a <select>.
export type Choice = readonly [value: string, label: string];
