// "Compare profiles" on Saves & profiles (#1074, ui/profiles/ProfileCompare.vue): drawn under a
// save with two or more calculated profiles from the figures the summary sends, the open profile
// as the baseline, differences with their sign, the fastest total marked, and the baseline and
// phase pickers redrawing it. Names are escaped; a profile without figures (a reply before #1074)
// leaves the comparison out.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { planFigures } from '../../public/state.ts';
import { $, $$, evil, generatedWith, go, open, page } from './setup.ts';
import { buildMinutes, setBuildMinutes } from '../../public/app/session.ts';
import { durationOfHours } from '../../public/wording.ts';
import type { ProfileSummary } from '../../public/types/index.ts';

const balanced = planFigures(generatedWith({ phase: '3', goal: 'balanced' }))!,
  minimal = planFigures(generatedWith({ phase: '3', goal: 'minimal' }))!;

const card = (id: string, name: string, figures = balanced): ProfileSummary => ({
  id,
  kind: 'calculated',
  name,
  completed: 0,
  phase: '4',
  figures,
});

function draw(profiles: ProfileSummary[]) {
  page();
  open({ workspace: { saves: [{ id: 's', name: 'World', activeProfile: 'p', profiles }] } });
  go('profiles');
  render();
}
const cellTexts = (id: string) =>
  [...$(`[data-compare-row="${id}"]`)!.querySelectorAll('td')].map(cell =>
    cell.textContent!.replace(/\s+/g, ' ').trim(),
  );
async function choose(selector: string, value: string) {
  const select = $<HTMLSelectElement>(selector)!;
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await nextTick();
}

test('Saves & profiles compares the profiles of a save against the open one', async () => {
  draw([card('p', 'Balanced'), card('m', evil, minimal)]);
  assert.ok($('[data-profile-compare="s"]'), 'the comparison is drawn');
  assert.equal($('x-evil'), null, 'a hostile name stays text');
  // The open profile is the baseline, on the phase it works on.
  assert.equal($<HTMLSelectElement>('[data-compare-baseline]')!.value, 'p');
  assert.equal($<HTMLSelectElement>('[data-compare-phase]')!.value, '4');
  assert.ok($('[data-compare-row="p"] [data-compare-baseline-tag]'));
  assert.equal($$('[data-compare-row="p"] [data-compare-delta]').length, 0);
  const four = { b: balanced.phases[1]!, m: minimal.phases[1]! };
  assert.equal(four.b.phase, '4');
  // Minimal builds fewer buildings: its difference says so with a minus sign.
  const buildings = $('[data-compare-row="m"] [data-compare-cell="0"] [data-compare-delta]')!;
  assert.ok(four.m.buildings! < four.b.buildings!);
  assert.match(buildings.textContent!, /^−/);
  assert.ok(buildings.classList.contains('lower'));
  // A slower plan's delivery time is later: a plus sign.
  const time = $('[data-compare-row="m"] [data-compare-cell="7"] [data-compare-delta]')!;
  assert.match(time.textContent!, /^\+/);
  assert.ok(time.classList.contains('higher'));
  // The fastest total is marked, in words.
  assert.ok($('[data-compare-time="p"] [data-compare-fastest]'));
  assert.equal($('[data-compare-time="m"] [data-compare-fastest]'), null);
  assert.equal($('[data-compare-time="p"] [data-compare-fastest]')!.textContent!.trim(), 'Fastest');

  // Another baseline: the differences turn around.
  await choose('[data-compare-baseline]', 'm');
  assert.equal($$('[data-compare-row="m"] [data-compare-delta]').length, 0);
  assert.match(
    $('[data-compare-row="p"] [data-compare-cell="0"] [data-compare-delta]')!.textContent!,
    /^\+/,
  );
  // Another phase: its figures.
  await choose('[data-compare-phase]', '5');
  assert.equal(
    cellTexts('p')[0]!.split(' ')[0],
    balanced.phases[2]!.buildings!.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  );
});

test('a save with one profile, or summaries without figures, has no comparison', () => {
  draw([card('p', 'Only')]);
  assert.equal($('[data-profile-compare]'), null);
  draw([
    { ...card('p', 'Old'), figures: undefined },
    { ...card('m', 'Older'), figures: undefined },
  ]);
  assert.equal($('[data-profile-compare]'), null);
});

test('a figure a plan does not hold reads "—"', () => {
  const sparse = structuredClone(balanced);
  for (const phase of sparse.phases) Object.assign(phase, { ore: null, oil: null, hours: null });
  sparse.totalHours = null;
  draw([card('p', 'Balanced'), card('o', 'Old plan', sparse)]);
  const cells = cellTexts('o');
  assert.equal(cells[4], '—');
  assert.equal(cells[5], '—');
  assert.equal(cells[7], '—');
  assert.doesNotMatch($('[data-profile-compare]')!.textContent!, /NaN|undefined/);
  assert.equal($('[data-compare-time="o"] [data-compare-total] .compare-value')!.textContent, '—');
});

// The time to finish (#1074): the plan's delivery time plus the buildings to add times the minutes
// per building set on the page, an estimate remembered in this browser (never stored with a
// profile); 0 compares delivery time only, and an out-of-range value puts the field back.
test('the minutes per building set the estimated building time of the time to finish', async () => {
  setBuildMinutes(3);
  draw([card('p', 'Balanced'), card('m', 'Minimal', minimal)]);
  await choose('[data-compare-baseline]', 'm');
  const field = $<HTMLInputElement>('[data-compare-build-minutes]')!;
  assert.equal(field.value, '3');
  const four = balanced.phases[1]!;
  const parts = $$(
    '[data-compare-time="p"] [data-compare-time-cell="1"] [data-compare-time-parts]',
  ).map(part => part.textContent);
  assert.equal(parts.length, 2);
  assert.match(parts[0]!, /delivery$/);
  assert.match(parts[1]!, /^\+ est\. .* building$/);
  assert.ok($('[data-compare-time="p"] [data-compare-total-parts]'));
  assert.match($('[data-compare-time-note]')!.textContent!, /estimate/);
  // The buildings to add and their parts, measured from the plan.
  assert.equal(
    cellTexts('p')[1]!.split(' ')[0],
    four.newBuildings!.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  );
  assert.match(cellTexts('p')[2]!, /parts/);

  field.value = '0';
  field.dispatchEvent(new Event('change'));
  await nextTick();
  assert.equal(buildMinutes, 0);
  assert.equal(localStorage.getItem('planner-build-minutes'), '0');
  assert.equal($('[data-compare-time-parts]'), null, 'delivery time only');
  assert.equal($('[data-compare-total-parts]'), null);
  assert.equal(
    $('[data-compare-time="p"] [data-compare-time-cell="1"] .compare-value')!.textContent,
    durationOfHours(four.hours!),
  );
  assert.equal($<HTMLSelectElement>('[data-compare-baseline]')!.value, 'm', 'the baseline stays');

  field.value = '500';
  field.dispatchEvent(new Event('change'));
  await nextTick();
  assert.equal(buildMinutes, 0, 'out of range is not taken');
  assert.equal(field.value, '0');
  setBuildMinutes(3);
});
