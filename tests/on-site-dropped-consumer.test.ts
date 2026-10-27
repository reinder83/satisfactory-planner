// Made on site (#1013, part of #1019): the plan's own solve can drop the very row a group's lines
// were for. Beta holds the Aluminum Sheet and Aluminum Casing lines and marks Aluminum Ingot;
// Gamma holds the Pure Aluminum Ingot line and marks Alumina Solution and Aluminum Scrap. The
// first recalculation builds Beta's lines and no Pure Aluminum Ingot row at all, so Gamma gets no
// line and nothing asks. Worked out from that plan's rows alone, the next recalculation (Alpha is
// added, marking Wire) left Gamma's items out, its solve brought the Pure Aluminum Ingot row back,
// and the notice asked at once for Gamma's lines, which the recalculation after it would have
// planned differently again. Now a consumer the solve dropped keeps its group's request, and
// neither side of the notice counts it as a line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { onSiteChange } from '../public/app/on-site-picker.ts';
import { STANDARD_BEFORE_1040 } from './helpers/standard-before-1040.ts';
import type { CalcRow, FactoryGroups, StoredCalculatedPlan } from '../public/types/index.ts';

const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22',
  GAMMA = 'fg-gamma1';
const PURE = 'Recipe_PureAluminumIngot_C';

// The issue's groups, with Alpha (the Cable line, marking Wire) once it is added, and Gamma holding
// the Pure Aluminum Ingot row whole (`rate` null) or at a fixed rate per minute.
function groups(withAlpha: boolean, rate: number | null = null): FactoryGroups {
  return {
    groups: [
      { id: BETA, name: 'Beta' },
      { id: GAMMA, name: 'Gamma' },
      ...(withAlpha ? [{ id: ALPHA, name: 'Alpha' }] : []),
    ],
    assignments: {
      Recipe_AluminumSheet_C: [{ group: BETA, rate: null }],
      Recipe_AluminumCasing_C: [{ group: BETA, rate: null }],
      [PURE]: [{ group: GAMMA, rate }],
      ...(withAlpha ? { Recipe_Cable_C: [{ group: ALPHA, rate: null }] } : {}),
    },
    local: {
      [BETA]: ['Aluminum Ingot'],
      [GAMMA]: ['Alumina Solution', 'Aluminum Scrap'],
      ...(withAlpha ? { [ALPHA]: ['Wire'] } : {}),
    },
  };
}

// The plan "Recalculate in place with items made on site" makes from `plan` and the groups now.
function recalculated(plan: StoredCalculatedPlan, groups: FactoryGroups) {
  const onSite = onSiteSettings(plan, groups);
  const { onSite: _old, ...rest } = plan.settings;
  return calculate({ ...rest, ...(onSite ? { onSite } : {}) });
}
const rows = (plan: StoredCalculatedPlan): CalcRow[] =>
  Object.values(plan.stages).flatMap(stage => stage.rows || []);
// Every phase's own lines (rows with `onSite`), as sorted "<phase>:<row id>".
const ownLines = (plan: StoredCalculatedPlan) =>
  Object.entries(plan.stages)
    .flatMap(([phase, stage]) =>
      (stage.rows || []).filter(row => row.onSite).map(row => `${phase}:${row.id}`),
    )
    .sort();

let first: StoredCalculatedPlan | undefined;
// The default plan on the recipes of the issue's time (with Pure Aluminum Ingot), recalculated
// once with Beta and Gamma, made once.
const firstPlan = () =>
  (first ??= recalculated(calculate({ ...STANDARD_BEFORE_1040 }), groups(false)));

test("#1013: the first recalculation drops the consumer of Gamma's marks, and nothing asks", () => {
  const plan = firstPlan();
  assert.ok(!rows(plan).some(row => row.id === PURE), 'no Pure Aluminum Ingot row in any phase');
  assert.ok(!ownLines(plan).some(line => line.endsWith(':' + GAMMA)), 'Gamma has no line');
  assert.deepEqual(plan.settings.onSite?.[GAMMA]?.items, ['Alumina Solution', 'Aluminum Scrap']);
  assert.equal(onSiteChange(plan, groups(false)), null);
});

test('#1013: a consumer the solve dropped keeps its group in the request, as no line', () => {
  const plan = firstPlan();
  const change = onSiteChange(plan, groups(true));
  assert.ok(change, 'adding Alpha asks');
  // The words name only lines: Gamma has none in this plan and gets none counted.
  assert.equal(change.now, 'Alpha makes Wire on site; Beta makes Aluminum Ingot on site');
  assert.equal(change.had, 'Beta makes Aluminum Ingot on site');
  // The request keeps Gamma's items, with its share of the row the solve dropped.
  const gamma = change.want?.[GAMMA];
  assert.deepEqual(gamma?.items, ['Alumina Solution', 'Aluminum Scrap']);
  assert.ok(Object.values(gamma?.shares || {}).every(phase => phase[PURE] === 1));
  // A group that no longer holds that row, or no longer marks the items, is left out as before.
  const left = groups(false);
  left.assignments[PURE] = [{ group: BETA, rate: null }];
  assert.equal(onSiteSettings(plan, left)?.[GAMMA], undefined);
  const unmarked = groups(false);
  unmarked.local![GAMMA] = ['Silica'];
  assert.equal(onSiteSettings(plan, unmarked)?.[GAMMA], undefined);
  // Neither change gives or drops a line, so neither asks.
  assert.equal(onSiteChange(plan, left), null);
  assert.equal(onSiteChange(plan, unmarked), null);
});

test('#1013: right after the recalculation the notice does not ask again, and the lines hold', () => {
  const next = recalculated(firstPlan(), groups(true));
  assert.equal(onSiteChange(next, groups(true)), null, 'no notice right after it');
  assert.deepEqual(ownLines(recalculated(next, groups(true))), ownLines(next));
});

// The same with Gamma holding the Pure Aluminum Ingot row only at a fixed rate (100/min, more than
// the row makes once it comes back). Where the plan lacks the row, that part has no share, only
// `ifBuilt` (#1038). The planner dropped such an entry (no shares), so the next solve brought the
// row back without Gamma's lines and the notice asked at once. Now the planner keeps it and sizes
// Gamma's line by the part where its solve builds the row, and the notice counts that line.
let fixedFirst: StoredCalculatedPlan | undefined;
const fixedPlan = () =>
  (fixedFirst ??= recalculated(calculate({ ...STANDARD_BEFORE_1040 }), groups(false, 100)));

test('#1013: a consumer held only at a fixed rate keeps its ifBuilt part, and nothing asks after', () => {
  const plan = fixedPlan();
  assert.ok(!rows(plan).some(row => row.id === PURE), 'no Pure Aluminum Ingot row in any phase');
  const change = onSiteChange(plan, groups(true, 100));
  assert.ok(change, 'adding Alpha asks');
  assert.equal(change.now, 'Alpha makes Wire on site; Beta makes Aluminum Ingot on site');
  const gamma = change.want?.[GAMMA];
  assert.deepEqual(gamma?.shares, {});
  assert.ok(Object.values(gamma?.ifBuilt || {}).every(phase => phase[PURE]?.rate === 100));
  const next = recalculated(plan, groups(true, 100));
  assert.deepEqual(next.settings.onSite?.[GAMMA]?.items, ['Alumina Solution', 'Aluminum Scrap']);
  assert.ok(
    ownLines(next).some(line => line.endsWith(':' + GAMMA)),
    'Gamma has its lines again',
  );
  assert.equal(onSiteChange(next, groups(true, 100)), null, 'no notice right after it');
  assert.deepEqual(ownLines(recalculated(next, groups(true, 100))), ownLines(next));
});
