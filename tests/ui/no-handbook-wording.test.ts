// "Handbook" is gone from what users see (decision 8 on #387, #802): every page, in every phase,
// edit mode and storage floor, the wizard's steps, the guided start and the node survey, ADA's
// remarks, and the dialogs (a factory, a group's build order, a container, an alternate recipe,
// a confirmation), drawn on a profile migrated from the handbook and on a calculated one. Any
// "handbook" in the rendered text, or in an attribute a user can see or hear, fails.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setAdaIndex } from '../../public/app/ada-panel.ts';
import { openCalculatedFactory, openGroupChain } from '../../public/app/factory-detail.ts';
import {
  calcStage,
  setFactoryEditing,
  setFloor,
  setLayoutEditing,
  setPlanEditing,
  setWizard,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { closeDetail } from '../../public/app/ui/actions.ts';
import { openSlot, storageBays } from '../../public/app/views/storage.ts';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { openAltRecipe } from '../../public/app/wizard/recipes.ts';
import { carryOptions } from '../../public/state.ts';
import {
  $$,
  answerConfirms,
  catalog,
  generated,
  go,
  migratedPlan,
  migratedState,
  open,
  page,
} from './setup.ts';
import type { View } from '../../public/app/session.ts';
import type { WizardDraft } from '../../public/app/wizard/wizard.ts';
import type {
  HandbookOrigin,
  Phase,
  ProgressState,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const HANDBOOK = /handbook/i;
// The attributes a user sees (a tooltip, a placeholder) or a screen reader reads out.
const SPOKEN = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'title',
  'placeholder',
  'alt',
];
const PAGES: View[] = [
  'plan',
  'factories',
  'logistics',
  'storage',
  'resources',
  'notes',
  'backup',
  'profiles',
];
const PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];

// The shared dialog is open, showing what was asked for.
const detailOpen = (what: string) =>
  assert.ok(document.querySelector<HTMLDialogElement>('#detail')!.open, what + ' is open');

// Fails naming where the word was drawn, with the text around it.
function noHandbook(where: string, text = shownText()) {
  const found = HANDBOOK.exec(text);
  if (found)
    assert.fail(
      `${where} says "handbook": …${text.slice(Math.max(0, found.index - 80), found.index + 80)}…`,
    );
}
function shownText() {
  const parts = [document.body.textContent || ''];
  for (const el of document.body.querySelectorAll('*')) {
    for (const name of SPOKEN) {
      const value = el.getAttribute(name);
      if (value) parts.push(value);
    }
    // A button's or field's own value is drawn too.
    if (el instanceof HTMLInputElement && el.type !== 'hidden' && el.value) parts.push(el.value);
  }
  return parts.join('\n').replace(/\s+/g, ' ');
}

// Records the migration could not place, so the Notes page lists them (#499).
const origin = (): HandbookOrigin => ({
  version: '2026-09-13',
  unmapped: {
    checks: { 'factory-4-plastic': true },
    notes: { 'factory-plastic': 'Kept note' },
    assignments: { rubber: [{ group: 'fg-a', rate: 30 }] },
  },
});

// Two groups, the first rows of Phase 3 split between them, so Logistics and the build order
// have something to draw.
function grouped(plan: StoredCalculatedPlan): ProgressState['factoryGroups'] {
  const rows = plan.stages['3']?.rows ?? [];
  return {
    groups: [
      { id: 'fg-a', name: 'Group A' },
      { id: 'fg-b', name: 'Group B' },
    ],
    assignments: Object.fromEntries(
      rows.map((row, i) => [row.id, [{ group: i % 2 ? 'fg-b' : 'fg-a', rate: null }]]),
    ),
  };
}

interface Kind {
  label: string;
  profileId: string;
  plan: () => StoredCalculatedPlan;
  state: (plan: StoredCalculatedPlan) => Partial<ProgressState>;
}
const KINDS: Kind[] = [
  {
    label: 'a profile migrated from the handbook',
    profileId: 'original',
    plan: migratedPlan,
    state: plan => ({
      ...migratedState({ checks: { 'factory-4-plastic': true } }),
      handbookOrigin: origin(),
      factoryGroups: grouped(plan),
    }),
  },
  {
    label: 'a calculated profile',
    profileId: 'p',
    plan: generated,
    state: plan => ({ factoryGroups: grouped(plan) }),
  },
];

function openKind(kind: Kind, phase: Phase = '3') {
  const plan = structuredClone(kind.plan());
  open({
    name: 'World',
    calculated: plan,
    phase,
    profileId: kind.profileId,
    workspace: { catalog: catalog() },
    state: { ...kind.state(plan), settings: { phase } },
  });
}

// Every remark ADA has for the page: the panel shows one at a time.
function adaRemarks(where: string) {
  for (let i = 0; i < 12; i++) {
    setAdaIndex(i);
    render();
    noHandbook(`${where}, ADA's remark ${i + 1}`);
  }
  setAdaIndex(0);
}

async function drawn(view: View, where: string) {
  go(view);
  render();
  await nextTick();
  noHandbook(where);
}

beforeEach(() => {
  page();
  setFloor('ground');
  setPlanEditing(false);
  setLayoutEditing(false);
  setFactoryEditing(false);
  setWizard(null);
});

for (const kind of KINDS) {
  // One test per phase, and one for the editing modes, rather than one loop over them all: each
  // phase draws every page and every ADA remark on it (over a hundred renders), and in a full
  // `npm test` the whole loop took long enough to pass the 30 s test timeout (#851). Split, each
  // test has its own budget and a failure names its phase.
  for (const phase of PHASES)
    test(`no page says "handbook" on ${kind.label}, in Phase ${phase}`, async () => {
      for (const view of PAGES) {
        page();
        openKind(kind, phase);
        await drawn(view, `${view} in Phase ${phase}`);
        adaRemarks(`${view} in Phase ${phase}`);
      }
    });

  test(`no page says "handbook" on ${kind.label}, in any editing mode or storage floor`, async () => {
    page();
    openKind(kind);
    setPlanEditing(true);
    await drawn('plan', 'the build plan being edited');
    setPlanEditing(false);
    setFactoryEditing(true);
    await drawn('factories', 'the factory groups being edited');
    setFactoryEditing(false);
    for (const floor of ['ground', 'upper', 'workshop']) {
      setFloor(floor);
      await drawn('storage', `the storage room's ${floor} floor`);
      setLayoutEditing(true);
      await drawn('storage', `the ${floor} floor's layout being edited`);
      setLayoutEditing(false);
    }
  });

  test(`no dialog says "handbook" on ${kind.label}`, async () => {
    openKind(kind);
    go('factories');
    render();
    for (const row of calcStage()?.rows ?? []) {
      openCalculatedFactory(row.id);
      detailOpen(row.name);
      noHandbook(`the dialog for ${row.name}`);
      await closeDetail();
    }
    for (const group of ['fg-a', 'fg-b']) {
      openGroupChain(group);
      detailOpen(group);
      noHandbook(`the build order of ${group}`);
      await closeDetail();
    }
    go('storage');
    render();
    for (const bay of storageBays())
      for (const slot of bay.items.filter(x => x.name)) {
        openSlot(slot.id);
        detailOpen(slot.id);
        noHandbook(`the container dialog for ${slot.id}`);
        await closeDetail();
      }
    for (const alternate of catalog().alternates!.slice(0, 5)) {
      openAltRecipe(alternate.id);
      detailOpen(alternate.name);
      noHandbook(`the alternate-recipe dialog for ${alternate.name}`);
      await closeDetail();
    }
    // The confirmations Saves & profiles asks: each menu item's, answered No.
    const asked = answerConfirms(false);
    go('profiles');
    render();
    await nextTick();
    for (const item of $$('#main [role=menuitem]')) {
      item.click();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(asked.length > 0, 'Saves & profiles asked something');
    for (const question of asked) noHandbook('a confirmation on Saves & profiles', question);
  });

  test(`the wizard, the guided start and the node survey never say "handbook" on ${kind.label}`, async () => {
    const draft = (extra: Partial<WizardDraft>): WizardDraft => ({
      step: 1,
      saveId: 's',
      saveName: 'World',
      name: '',
      settings: structuredClone(kind.plan().settings),
      preview: null,
      // Carrying from the migrated profile names where its plan came from (#480).
      carryFrom: 'original',
      carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
      mode: 'advanced',
      guidedStep: 1,
      guidedAsk: null,
      tutorial: 'doing',
      ...extra,
    });
    const show = async (where: string, extra: Partial<WizardDraft>) => {
      page();
      openKind(kind);
      setWizard(draft(extra));
      await drawn('wizard', where);
      adaRemarks(where);
    };
    for (const step of [1, 2, 3, 4, 5])
      await show(`All settings step ${step}`, {
        step,
        preview: step === 5 ? structuredClone(kind.plan()) : null,
      });
    page();
    openKind(kind);
    setWizard(draft({ mode: 'guided' }));
    for (let step = 1; step <= guidedFlow().length; step++)
      await show(`guided screen ${step}`, { mode: 'guided', guidedStep: step });
    for (const step of [1, 2, 3, 4])
      await show(`node survey screen ${step}`, {
        step: 4,
        mode: 'extraction',
        extractionStep: step,
        extractionReturn: { mode: 'advanced', step: 4, guidedStep: 1 },
      });
  });
}
