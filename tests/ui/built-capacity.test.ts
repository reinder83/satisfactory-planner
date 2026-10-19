// Built-aware solving (#1176): Edit settings sends the production lines that stand in the profile
// (ticked as built) with Review's preview and with "Recalculate in place", so the solve keeps and
// extends them, and Review's "What changes" says so. A profile with nothing ticked sends none,
// and the plan's recalculation offers name the kept lines in their confirmation.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWorkspace, wizard, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { builtKeptText, withBuiltLines } from '../../public/app/built-capacity.ts';
import { offerQuestion } from '../../public/app/ui/recalc-offer.ts';
import type { StoredCalculatedPlan } from '../../public/types/index.ts';
import { $, catalog, generated, go, open, page, stubFetch } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
const SCREWS = 'Recipe_Screw_C';

let plan: StoredCalculatedPlan;
const openWith = (checks: Record<string, boolean>) => {
  page();
  plan = generated();
  open({ name: 'Standard', calculated: plan, state: { checks } });
  setWorkspace({ ...workspace, catalog: catalog() });
  HTMLFormElement.prototype.reportValidity = () => true;
  go('plan');
  render();
};
beforeEach(() => openWith({ ['calc-4-' + SCREWS]: true }));

async function review(preview: StoredCalculatedPlan) {
  const calls = stubFetch<Record<string, unknown>>({
    '/api/preview': preview,
    '/api/recalculate': {
      workspace,
      saveId: 's',
      profileId: 'p',
      backupId: 'b',
      reviewCount: 0,
      carriedChecks: 1,
    },
  });
  $('button[data-profile-switcher]')!.click();
  await settle();
  $('[data-edit-open-profile]')!.click();
  await settle();
  render();
  await settle();
  $('[data-wizard-step="5"]')!.click();
  await settle();
  await settle();
  return calls;
}

test('Edit settings sends the lines that stand and Review says they are kept', async () => {
  const screws = plan.stages['4']!.rows!.find(row => row.id === SCREWS)!.machines;
  const lines = { '4': { [SCREWS]: screws } };
  const preview = generated();
  preview.settings = withBuiltLines(preview.settings, lines);
  const calls = await review(preview);
  const sent = calls.find(([path]) => path === '/api/preview');
  assert.ok(sent, 'Review calculates a preview');
  assert.deepEqual((sent[1].settings as { builtLines?: unknown }).builtLines, lines);
  assert.equal(
    text('[data-edit-built]'),
    'Built production lines are kept. 1 production line you built in Phase 4 is kept: the plan ' +
      'counts its machines as standing, so it keeps and extends it rather than replacing it, ' +
      'and plans the rest around it.',
  );
  assert.equal(wizard!.settings.builtLines?.['4']?.[SCREWS], screws);

  calls.length = 0;
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  const recalc = calls.find(([path]) => path === '/api/recalculate');
  assert.ok(recalc, 'the button recalculates');
  assert.deepEqual((recalc[1].settings as { builtLines?: unknown }).builtLines, lines);
});

test('a profile with nothing ticked sends no built lines and Review says nothing of them', async () => {
  openWith({});
  const calls = await review(generated());
  const sent = calls.find(([path]) => path === '/api/preview')!;
  assert.equal('builtLines' in (sent[1].settings as object), false);
  assert.equal($('[data-edit-built]'), null);
});

test('the words for kept lines and the offers’ confirmation', () => {
  assert.equal(builtKeptText(undefined), '');
  assert.match(
    builtKeptText({ '3': { a: 1 }, '4': { b: 2, c: 3 } }),
    /^3 production lines you built in Phases 3 and 4 are kept: the plan counts their machines as standing, so it keeps and extends them rather than replacing them, and plans the rest around them\.$/,
  );
  assert.match(
    offerQuestion('World', 'with exact clocks', 'World (before edit)', false, 12),
    /^Recalculates “World” with exact clocks\. The 12 production lines you built are kept and extended rather than replaced\. Its progress is carried: /,
  );
  assert.match(
    offerQuestion('World', 'with exact clocks', 'World (before edit)', false),
    /^Recalculates “World” with exact clocks\. Its progress is carried: /,
  );
  assert.deepEqual(withBuiltLines({ a: 1, builtLines: { '4': { x: 1 } } }, undefined), { a: 1 });
});
