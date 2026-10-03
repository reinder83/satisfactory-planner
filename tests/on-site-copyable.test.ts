// Made on site (#967): once a group marks a part, its "Made on site" picker also offers the
// ingredients of the part's recipe, because a recalculation gives the group its own line of that
// recipe, which takes the ingredients the group marks from its own lines (siteCopies in
// planner/on-site.ts). The picker follows only the recipes the planner copies for a group
// (onSiteCopyable in public/app/on-site.ts), so it never offers an ingredient of a line no
// recalculation makes, such as a nuclear one (#933). This checks the two rules agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../planner.ts';
import { siteCopies } from '../planner/on-site.ts';
import { onSiteCopyable, onSitePlannable } from '../public/app/on-site.ts';
import { recipes } from './helpers/data.ts';

const ALPHA = 'fg-alpha1';

test('the picker follows a part to its ingredients exactly where the planner copies its recipe', () => {
  let copied = 0,
    skipped = 0;
  for (const recipe of recipes)
    for (const part of Object.keys(recipe.outputs).filter(onSitePlannable)) {
      // Alpha marks `part`, and its one consumer takes it.
      const consumer = {
        id: 'Consumer',
        name: 'Consumer',
        phase: 1,
        machine: 'Constructor',
        power: 4,
        inputs: { [part]: 1 },
        outputs: {},
      };
      const config = settings({
        onSite: { [ALPHA]: { items: [part], shares: { '3': { Consumer: 1 } } } },
      });
      const planner = siteCopies(config, 3, [consumer, recipe]).some(
        copy => copy.onSite?.recipe === recipe.id,
      );
      assert.equal(onSiteCopyable(recipe), planner, `${recipe.name} for ${part}`);
      if (planner) copied++;
      else skipped++;
    }
  // Both kinds are there: most recipes are copied, nuclear ones are not.
  assert.ok(copied > 100 && skipped > 0, `${copied} copied, ${skipped} not`);
});
