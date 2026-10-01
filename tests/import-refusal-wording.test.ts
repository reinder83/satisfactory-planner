// The Backup page shows an import refusal as its error toast, in both editions. Owner decision 8
// on #387: no "handbook" wording anywhere, so none of them names the handbook or an "original
// profile" (#630); the refusals for a file from an older planner say to export it again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState } from '../server.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import frozenJson from '../migrations/handbook-2026-09-13.json' with { type: 'json' };

const retired = /handbook|original profile/i;
const next = /Export it again from the planner that made it\.$/;

test('no import refusal in transfer.ts names the handbook or an original profile', () => {
  const source = readFileSync(new URL('../public/transfer.ts', import.meta.url), 'utf8');
  const messages = [...source.matchAll(/invalid\(\s*(['`])((?:(?!\1).)*)\1/g)].map(m => m[2]!);
  assert.ok(messages.length >= 10, 'found the refusals: ' + messages.length);
  for (const message of messages) assert.doesNotMatch(message, retired);
});

const exportOf = (handbook: unknown) => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  saves: [
    {
      id: 's',
      name: 'World',
      activeProfile: 'p',
      profiles: [{ id: 'p', name: 'Mine', kind: 'original', handbook, state: initialState() }],
    },
  ],
});
const refusal = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    return error as Error & { status?: number };
  }
  assert.fail('the import was not refused');
};

test('each refusal of a file from an older planner says what to do next', async () => {
  const whole = () => structuredClone(frozenJson) as Record<string, unknown>;
  const cases: [string, () => unknown][] = [
    ['no handbook', () => validateTransfer(exportOf(undefined))],
    ['sources not a list', () => validateTransfer(exportOf({ ...whole(), sources: 5 }))],
    [
      'a partial handbook',
      () => validateTransfer(exportOf({ factories: [], phases: {}, storage: [] })),
    ],
    [
      'a conversion that fails',
      // @ts-expect-error: conversion data without recipes, on purpose.
      () => importableTransfer(exportOf(whole()), async () => ({})),
    ],
  ];
  for (const [name, run] of cases) {
    const error = await refusal(run);
    assert.equal(error.status, 400, name + ': ' + error.message);
    assert.doesNotMatch(error.message, retired, name);
    assert.match(error.message, next, name);
  }
});

// Every other refusal an import can meet names the file and the same next step (#662), including
// validateState's short ones, which the import path wraps. No refusal names the handbook.
const calculated = (profile: Record<string, unknown> = {}, save: Record<string, unknown> = {}) => {
  const stages = Object.fromEntries(
    ['1', '2', '3', '4', '5'].map(phase => [phase, { rows: [], feasible: true }]),
  );
  return {
    format: 'satisfactory-planner-saves',
    version: 1,
    saves: [
      {
        id: 's',
        name: 'World',
        activeProfile: 'p',
        profiles: [
          {
            id: 'p',
            name: 'Mine',
            kind: 'calculated',
            plan: { settings: {}, stages, warnings: [] },
            state: initialState(),
            ...profile,
          },
        ],
        ...save,
      },
    ],
  };
};

test('a calculated export that is whole imports, so the cases below fail on one thing', () => {
  assert.equal(validateTransfer(calculated()).saves.length, 1);
});

test('every import refusal names the save file and a next step, never the handbook', async () => {
  const state = (change: Record<string, unknown>) => ({ state: { ...initialState(), ...change } });
  const cases: [string, unknown, RegExp][] = [
    ['a damaged origin', calculated(state({ handbookOrigin: 5 })), /damaged progress.*earlier/],
    ['a damaged phase', calculated(state({ settings: { phase: 9 } })), /Invalid selected phase\./],
    ['no state version', calculated(state({ version: undefined })), /damaged progress, so/],
    ['a bad kind', calculated({ kind: 'handbook' }), /a damaged profile,/],
    ['no calculation', calculated({ plan: {} }), /plan without its calculation/],
    [
      'a missing stage',
      calculated({ plan: { settings: {}, stages: {}, warnings: [] } }),
      /plan with a damaged phase/,
    ],
    [
      'a bad guide',
      calculated({ plan: { ...calculated().saves[0]!.profiles[0]!.plan, guide: 5 } }),
      /damaged plan guide/,
    ],
    ['an empty name', calculated({ name: ' ' }), /usable name/],
    ['no active profile', calculated({}, { activeProfile: 'q' }), /profile list is damaged/],
    ['no profiles', calculated({}, { profiles: [] }), /too many profiles/],
    [
      'a prototype key',
      JSON.parse(JSON.stringify(calculated()).replace('"settings"', '"__proto__"')),
      /too large or damaged/,
    ],
  ];
  for (const [name, data, detail] of cases) {
    const error = await refusal(() => importableTransfer(data));
    assert.equal(error.status, 400, name + ': ' + error.message);
    assert.match(error.message, /^This save file /, name);
    assert.match(error.message, detail, name);
    assert.match(error.message, next, name);
    assert.doesNotMatch(error.message, retired, name);
  }
});

test('a state from a newer planner keeps its update message on import', async () => {
  const error = await refusal(() =>
    validateTransfer(calculated({ state: { ...initialState(), version: 13 } })),
  );
  assert.equal(error.status, 400);
  assert.match(error.message, /newer planner version\. Update the app to import it\.$/);
});
