// The Backup page shows an import refusal as its error toast, in both editions. Owner decision 8
// on #387: no "handbook" wording anywhere, so none of them names the handbook or an "original
// profile" (#630); the refusals for a file from an older planner say to export it again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState } from '../server.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import frozenJson from '../migrations/handbook-2026-09-13.json' with { type: 'json' };
import type { MigrationData } from '../public/handbook-migration.ts';

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
      () => importableTransfer(exportOf(whole()), async () => ({}) as unknown as MigrationData),
    ],
  ];
  for (const [name, run] of cases) {
    const error = await refusal(run);
    assert.equal(error.status, 400, name + ': ' + error.message);
    assert.doesNotMatch(error.message, retired, name);
    assert.match(error.message, next, name);
  }
});
