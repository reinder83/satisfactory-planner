// The handbook transcribed into a calculated snapshot (#486) draws on every calculated page, in
// the empty early phases and the planned ones: nothing throws, the guide's steps lead the plan
// page, and the factory rows are on the factories page.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { test } from 'vitest';
import handbookJson from '../../public/plan.json' with { type: 'json' };
import recipesJson from '../../recipes.json' with { type: 'json' };
import { handbookToPlan } from '../../public/handbook-migration.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, catalog, go, open, page } from './setup.ts';
import type { Handbook, Phase, Recipe } from '../../public/types/index.ts';

const { plan } = handbookToPlan(
  handbookJson as unknown as Handbook,
  (recipesJson as unknown as { recipes: Recipe[] }).recipes,
  catalog().pureLimits,
);

test('the transcribed handbook draws on every calculated page in every phase', async () => {
  page();
  for (const phase of ['1', '3', '5', 'post'] as Phase[])
    for (const view of ['plan', 'factories', 'logistics', 'storage', 'resources'] as const) {
      open({ calculated: structuredClone(plan), phase });
      go(view);
      render();
      await nextTick();
      assert.ok($('#main h1'), `${view} in ${phase} has its heading`);
    }
  open({ calculated: structuredClone(plan), phase: '3' });
  go('plan');
  render();
  await nextTick();
  assert.deepEqual(
    $$('#main [data-check]')
      .map(b => b.dataset.check)
      .filter(k => k!.startsWith('phase-3-')),
    plan.guide!.phases['3']!.map(t => t.id),
    "the guide's Phase 3 steps, in order",
  );
  go('factories');
  render();
  await nextTick();
  assert.equal(
    $$('#main .factory-card button.name').length,
    plan.stages['3'].rows!.length,
    'a card per row',
  );
  // Every resource the stage draws has a budget, Water included.
  open({ calculated: structuredClone(plan), phase: '3', workspace: { catalog: catalog() } });
  go('resources');
  render();
  await nextTick();
  assert.ok($$('#main tbody tr').length > 10, 'the resource table is drawn');
  assert.equal($('#main [data-over]'), null, 'nothing reads as over a missing budget');
});
