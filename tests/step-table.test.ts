// The mining step as a table (#1136, miningStep in public/mining.ts): one row per resource with
// its Power Shards (#1137), a total row, the same intro line as the body, and the body unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { miningStep, miningStepBody } from '../public/mining.ts';
import { phaseMining, resourceDefaults } from '../public/preferences.ts';
import { tableText } from '../public/step-table.ts';
import type { StoredStage } from '../public/types/index.ts';

const limits = resourceDefaults('vanilla', 'original').limits;
const stage = (overclock: boolean) =>
  ({
    mining: phaseMining({ limits, ...(overclock ? { overclock } : {}) }, 3),
    raw: { 'Iron Ore': 2356.75, 'Crude Oil': 2904.53 },
  }) as Pick<StoredStage, 'mining' | 'raw'>;

test("the owner's case as a table: Iron Ore on 5 Miner Mk.2 with 10 Power Shards", () => {
  const step = miningStep(stage(true), '3', { limits, overclock: true })!;
  assert.equal(step.body, miningStepBody(stage(true), '3', { limits, overclock: true }));
  assert.ok(step.body.startsWith(step.table.intro), 'the intro is the body’s first sentence');
  assert.deepEqual(step.table.columns, [
    'Resource',
    'Rate',
    'Nodes',
    'Machines',
    'Shards',
    'Power',
  ]);
  const [iron, oil] = step.table.rows;
  assert.equal(iron![0], 'Iron Ore');
  assert.equal(iron![2], '5 pure');
  assert.match(iron![3]!, /^Miner Mk\.2: 4 at 200% and 1 at 181[.,]98%$/);
  assert.equal(iron![4], '10');
  assert.match(iron![5]!, /MW$/);
  assert.equal(oil![0], 'Crude Oil');
  assert.match(oil![1]!, / m³\/min$/);
  // A fluid lists its 100% option after the overclocked one it counts.
  assert.match(oil![3]!, /^Oil Extractor: 4 at 250% and 1 at 210[.,]22%\. At 100%: /);
  assert.equal(oil![4], '15');
  assert.deepEqual(step.table.total!.slice(0, 3), ['Total', '', '10 nodes']);
  assert.equal(step.table.total![3], '10 machines');
  assert.equal(step.table.total![4], '25');
  assert.equal(step.table.after, undefined, 'no advice once the player can overclock');
});

test('without Power Shards the table says None and the advice follows it', () => {
  const step = miningStep(stage(false), '3', { limits })!;
  assert.equal(step.table.rows[0]![4], 'None');
  assert.match(step.table.after!, /^Research Power Shards in the MAM/);
  assert.ok(step.body.endsWith(step.table.after!));
  assert.match(tableText(step.table), /Machines Shards Power/);
  assert.equal(tableText(undefined), '');
});
