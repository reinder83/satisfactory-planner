// "I can overclock" (#1137, OwnedEquipment.vue): the wizard reads settings.overclock only with
// mining per phase; its hidden `overclockAsked` field tells a box left unticked from one not drawn,
// which the guided start keeps as it was.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readOwnedEquipment, type WizardSettings } from '../../public/app/wizard/wizard.ts';

// The fields a wizard draft always has; only the owned fields matter here.
const BASE = { phase: '3', limits: {} } as WizardSettings;
const form = (fields: [string, string][]) => {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
};
const draft = (extra: Partial<WizardSettings> = {}): WizardSettings => ({
  ...BASE,
  phaseMining: true,
  ...extra,
});

test('the wizard reads "I can overclock" only with mining per phase', () => {
  const ticked = draft();
  readOwnedEquipment(
    form([
      ['overclockAsked', '1'],
      ['overclock', 'on'],
    ]),
    ticked,
  );
  assert.equal(ticked.overclock, true);
  const unticked = draft({ overclock: true });
  readOwnedEquipment(form([['overclockAsked', '1']]), unticked);
  assert.equal('overclock' in unticked, false);
  const flat: WizardSettings = { ...BASE, overclock: true };
  readOwnedEquipment(
    form([
      ['overclockAsked', '1'],
      ['overclock', 'on'],
    ]),
    flat,
  );
  assert.equal('overclock' in flat, false, 'only with mining per phase');
});

test('the guided start keeps "I can overclock" where it did not draw the box', () => {
  const hidden = draft({ overclock: true });
  readOwnedEquipment(form([]), hidden, true);
  assert.equal(hidden.overclock, true);
});
