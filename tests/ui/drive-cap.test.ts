// The cap on hard drives (#1233) in the interface: All settings step 3 has "At most this many
// hard-drive alternates in the whole plan" in the caps fieldset (ui/wizard/PhaseCaps.vue), blank by
// default; the draft keeps the number typed (0 included) and leaves the field out when the box is
// blank, as settings() stores it. A plan calculated with a cap names it in the sidebar footer, and
// ADA's calm line says the hard-drive steps follow it.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { setView, setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const box = () => $<HTMLInputElement>('input[name="driveCap"]')!;
const plain = (text: string | null | undefined) => (text || '').replace(/[\s  ]+/g, ' ').trim();

// Step 3 of the five steps, as "All settings" leaves it, from `settings`.
function goalStep(settings: CurrentCalculatedPlan['settings']) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 3,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(settings),
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

async function pressContinue() {
  $<HTMLFormElement>('#wizard-form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await settle();
}

beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts).
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('step 3 has the cap on hard drives in the caps fieldset, and the draft keeps the number', async () => {
  goalStep(generated().settings);
  const field = box();
  assert.ok(field.closest('[data-phase-caps]'), 'in the caps fieldset');
  assert.ok(field.hasAttribute('data-drive-cap'));
  assert.match(
    plain(field.closest('label')!.textContent),
    /^At most this many hard-drive alternates in the whole plan/,
  );
  assert.equal(field.min, '0');
  assert.equal(field.max, '200');
  assert.equal(field.placeholder, 'No cap');
  assert.equal(field.value, '', 'no cap by default');
  field.value = '3';
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.equal(wizard!.settings.driveCap, 3);
});

test('a draft shows its cap, 0 is a cap, and a blank box leaves the field out again', async () => {
  goalStep({ ...generated().settings, driveCap: 2 });
  assert.equal(box().value, '2');
  box().value = '0';
  await pressContinue();
  assert.equal(wizard!.settings.driveCap, 0);
  goalStep({ ...generated().settings, driveCap: 2 });
  box().value = '';
  await pressContinue();
  assert.equal(wizard!.step, 4);
  assert.equal('driveCap' in wizard!.settings, false);
});

test('the sidebar names the cap on hard drives a plan was calculated with, beside the other caps', () => {
  const footer = () => plain($('.sidebar-foot .profile-switcher')!.textContent);
  for (const [extra, shown] of [
    [{}, null],
    [{ driveCap: 3 }, 'Caps: at most 3 hard-drive alternates'],
    [{ driveCap: 0, beltCap: 4 }, 'Caps: belts up to Mk.4 (480/min); no hard-drive alternates'],
  ] as const) {
    unmountShell();
    document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
    setView('plan');
    const plan = generated();
    Object.assign(plan.settings, structuredClone(extra));
    open({ calculated: plan });
    render();
    if (shown) assert.ok(footer().includes(shown), footer());
    else assert.doesNotMatch(footer(), /Caps:/);
  }
});

test("ADA names a plan's cap on hard drives on the build plan", () => {
  const adaLine = (extra: object) => {
    page();
    const plan = generated();
    Object.assign(plan.settings, extra);
    open({ calculated: plan });
    go('plan');
    adaClearFault();
    for (let i = 0; i < 60; i++) {
      setAdaIndex(i);
      const line = adaCurrent();
      if (line?.id === 'drive-cap') return line;
    }
    return undefined;
  };
  const line = adaLine({ driveCap: 3 });
  assert.equal(line?.tone, 'calm');
  assert.equal(
    line?.text,
    'This plan counts on at most 3 hard-drive alternates beyond the ones you own, over all its phases: its hard-drive steps list only those, and every number here already counts the cap. Fewer crash sites, same deadline.',
  );
  assert.equal(adaLine({}), undefined);
});
