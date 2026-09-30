// How the five-step wizard reads its form into the draft (readWizard) and how a new draft
// starts (startWizard), in public/app/wizard/wizard.ts: the field-to-setting mapping, the
// per-step checkboxes, the readers that only run when their section is on screen, the
// world-preset reset, and the fresh, copied and handbook starting settings. The forms here
// are plain DOM forms, not the step components (tests/ui/wizard.test.ts draws those).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { GUIDED_TOPUP_RATE, resourceDefaults } from '../../public/preferences.ts';
import { setWizard, wizard, workspace } from '../../public/app/session.ts';
import { readWizard, startWizard } from '../../public/app/wizard/wizard.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';
import type { Catalog, StoredSettings } from '../../public/types/index.ts';
import { catalog, generated, open, page } from './setup.ts';

let items: Catalog;

beforeEach(() => {
  items ??= catalog();
  page();
  open({ workspace: { catalog: items } });
});

// A draft at `step` in the five steps; `settings` overrides the calculated plan's settings.
function draftAt(step: number, settings: Partial<WizardSettings> = {}): WizardDraft {
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: { ...structuredClone(generated().settings), ...settings },
    preview: generated(),
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  return wizard!;
}

// A form holding `fields` as hidden inputs (a name may repeat), ticked checkboxes named in
// `ticked`, and an empty element for each class in `sections` (".alt-list", ".rate-list").
function formOf(fields: [string, string][], ticked: string[] = [], sections: string[] = []) {
  const form = document.createElement('form');
  for (const [name, value] of fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  for (const name of ticked) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.name = name;
    box.checked = true;
    form.append(box);
  }
  for (const section of sections) {
    const el = document.createElement('div');
    el.className = section;
    form.append(el);
  }
  document.body.append(form);
  return form;
}

test('each field writes its own setting, MW as GW, and the preview is cleared', () => {
  const draft = draftAt(2);
  const limitKey = Object.keys(draft.settings.limits)[0]!;
  readWizard(
    formOf([
      ['availablePowerMW', '2500'],
      ['installedPowerMW', '1500'],
      ['saveName', 'My world'],
      ['profileName', 'Rush'],
      [`limit:${limitKey}`, '123'],
      ['multiplier', '3'],
      ['hours', '6'],
      ['collectables', 'true'],
      ['pureIngots', 'false'],
      ['goal', 'timed'],
      ['phaseTime', 'final'],
      ['modNotes', 'no mods'],
      ['unknownField', 'ignored'],
    ]),
  );
  const settings = draft.settings;
  assert.equal(settings.availablePowerGW, 2.5);
  assert.equal(settings.installedPowerGW, 1.5);
  assert.equal(draft.saveName, 'My world');
  assert.equal(draft.name, 'Rush');
  assert.equal(settings.limits[limitKey], 123);
  assert.equal(settings.multiplier, 3);
  assert.equal(settings.hours, 6);
  assert.equal(settings.collectables, true);
  assert.equal(settings.pureIngots, false);
  assert.equal(settings.goal, 'timed');
  assert.equal(settings.phaseTime, 'final');
  assert.equal(settings.modNotes, 'no mods');
  assert.equal('unknownField' in settings, false, 'a name that is no setting writes nothing');
  assert.equal(
    'saveName' in settings || 'availablePowerMW' in settings,
    false,
    'draft fields stay off',
  );
  assert.equal(draft.preview, null);
});

test('checkboxes are read only on the step that draws them', () => {
  const draft = draftAt(2, { roundRates: true, wholeMachines: true, limitsConfirmed: true });
  readWizard(formOf([]));
  assert.deepEqual(
    [draft.settings.roundRates, draft.settings.wholeMachines, draft.settings.limitsConfirmed],
    [true, true, true],
    'another step leaves them',
  );
  draft.step = 3;
  readWizard(formOf([], ['wholeMachines']));
  assert.deepEqual([draft.settings.roundRates, draft.settings.wholeMachines], [false, true]);
  assert.equal(draft.settings.limitsConfirmed, true, 'step 3 does not draw the budget checkbox');
  draft.step = 4;
  readWizard(formOf([]));
  assert.equal(draft.settings.limitsConfirmed, false);
  assert.deepEqual([draft.settings.roundRates, draft.settings.wholeMachines], [false, true]);
});

test('alternates and storage rates are read only while their section is on screen', () => {
  const draft = draftAt(2, {
    alternateRecipes: ['kept'],
    preferredRecipes: ['kept'],
    storageOverrides: { Concrete: 5 },
  });
  readWizard(formOf([['alt', 'a']]));
  assert.deepEqual(draft.settings.alternateRecipes, ['kept']);
  assert.deepEqual(draft.settings.storageOverrides, { Concrete: 5 });
  readWizard(
    formOf(
      [
        ['alt', 'a'],
        ['alt', 'b'],
        ['altpref', 'b'],
        ['altpref', 'c'],
        ['rate:Concrete', '60'],
        ['rate:Screws', '0'],
        ['rate:Wire', ' '],
        ['rate:Rotor', 'many'],
      ],
      [],
      ['alt-list', 'rate-list'],
    ),
  );
  assert.deepEqual(draft.settings.alternateRecipes, ['a', 'b']);
  assert.deepEqual(draft.settings.preferredRecipes, ['b'], 'only a ticked alternate is preferred');
  assert.deepEqual(draft.settings.storageOverrides, { Concrete: 60, Screws: 0 });
});

test('a new world on step 1 replaces the budgets and asks to confirm them again', () => {
  const draft = draftAt(1, { purity: 'normal', distribution: 'original', limitsConfirmed: true });
  const limitKey = Object.keys(draft.settings.limits)[0]!;
  draft.settings.limits[limitKey] = 1;
  readWizard(formOf([['purity', 'normal']]));
  assert.equal(draft.settings.limits[limitKey], 1, 'the same world keeps typed budgets');
  assert.equal(draft.settings.limitsConfirmed, true);
  readWizard(formOf([['purity', 'pure']]));
  assert.deepEqual(draft.settings.limits, resourceDefaults('pure', 'original').limits);
  assert.equal(draft.settings.limitsConfirmed, false);
  // Step 2 writes the same field without the reset.
  draft.step = 2;
  draft.settings.limitsConfirmed = true;
  readWizard(formOf([['purity', 'vanilla']]));
  assert.equal(draft.settings.purity, 'vanilla');
  assert.equal(draft.settings.limitsConfirmed, true);
});

test('a new save starts from fresh settings with the Concrete top-up', () => {
  open({ workspace: { catalog: items, saves: [] } });
  startWizard();
  const draft = wizard!;
  assert.equal(draft.saveId, null);
  assert.equal(draft.saveName, '');
  assert.equal(draft.carryFrom, null);
  assert.equal(draft.mode, 'guided');
  assert.equal(draft.tutorial, 'doing');
  assert.equal(draft.settings.purity, 'vanilla');
  assert.equal(draft.settings.phase, '3', 'the server edition starts at Phase 3');
  assert.deepEqual(draft.settings.storageOverrides, { Concrete: GUIDED_TOPUP_RATE });
  assert.deepEqual(draft.settings.limits, workspace.catalog.limits);
  assert.notEqual(draft.settings.limits, workspace.catalog.limits, 'a copy');
  assert.deepEqual(draft.carry, Object.fromEntries(carryOptions.map(([key]) => [key, true])));
});

test("a save's next profile starts from a copy of its active profile's settings", () => {
  const active = { ...generated().settings, multiplier: 7 } as StoredSettings;
  open({
    workspace: {
      catalog: items,
      saves: [
        {
          id: 's',
          name: 'World',
          activeProfile: 'p',
          profiles: [
            { id: 'p', kind: 'calculated', name: 'P', completed: 0, phase: '3', settings: active },
          ],
        },
      ],
    },
  });
  startWizard('s');
  const draft = wizard!;
  assert.equal(draft.saveId, 's');
  assert.equal(draft.saveName, 'World');
  assert.equal(draft.carryFrom, 'p');
  assert.deepEqual(draft.settings, active);
  assert.notEqual(draft.settings, active, 'a copy');
  assert.deepEqual(draft.settings.storageOverrides, active.storageOverrides, 'no top-up added');
});

test('the handbook profile starts from the handbook assumptions', () => {
  // open() makes the handbook profile ('original') the save's active one.
  startWizard('s');
  const settings = wizard!.settings;
  assert.deepEqual(
    [
      settings.purity,
      settings.distribution,
      settings.multiplier,
      settings.nuclear,
      settings.goal,
      settings.cellsPerMinute,
    ],
    ['pure', 'randomized', 50, 'recycle', 'timed', 20],
  );
  assert.deepEqual(settings.limits, workspace.catalog.pureLimits);
  assert.equal(settings.storageOverrides, undefined, 'no top-up added');
});
