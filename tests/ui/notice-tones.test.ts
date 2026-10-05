// Notice tones (SP-12, #247): every .notice names exactly one of .info, .warn and .error, and
// orange (.warn) is kept for something wrong or at risk. The templates are checked as source,
// so a notice no test draws is covered too, and the main pages are drawn to check what renders.
// setup.ts also checks every page a component test leaves drawn.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, test } from 'vitest';
import { setFloor, setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { carryOptions } from '../../public/state.ts';
import { $$, catalog, generated, go, open, page, TONES, untonedNotices } from './setup.ts';
import type { View } from '../../public/app/session.ts';
import type { WizardDraft } from '../../public/app/wizard/wizard.ts';
import type { CurrentCalculatedPlan, FuelVerdict } from '../../public/types/index.ts';

const vueFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry =>
      entry.isDirectory()
        ? vueFiles(path.join(dir, entry.name))
        : entry.name.endsWith('.vue')
          ? [path.join(dir, entry.name)]
          : [],
    );

test('every notice in the templates names one tone', () => {
  const wrong: string[] = [];
  let seen = 0;
  for (const file of vueFiles('public/app/ui')) {
    const source = fs.readFileSync(file, 'utf8');
    // Each opening tag with a class list that holds "notice".
    for (const [tag] of source.matchAll(
      /<[a-z][\w-]*\s[^>]*?\bclass="[^"]*\bnotice\b[^"]*"[^>]*>/g,
    )) {
      seen++;
      const classes = /\sclass="([^"]*)"/.exec(tag)![1]!.split(/\s+/); // the match above has one
      const fixed = classes.filter(c => TONES.includes(c));
      // A tone chosen at run time: every literal in the :class binding is a tone.
      const bound = /\s:class="([^"]*)"/.exec(tag)?.[1];
      const literals = bound ? [...bound.matchAll(/'([^']*)'/g)].map(m => m[1]!) : [];
      const ok = bound
        ? !fixed.length && literals.length > 0 && literals.every(l => TONES.includes(l))
        : fixed.length === 1;
      if (!ok || classes.includes('blue')) wrong.push(`${path.basename(file)}: ${tag}`);
    }
    assert.doesNotMatch(source, /:class="\[?'notice/, `${file}: bind the tone, not "notice"`);
  }
  assert.ok(seen > 30, `found the notices (${seen})`);
  assert.deepEqual(wrong, []);
});

// A calculated plan whose current phase is a draft with power headroom to allow.
function draftPlan(): CurrentCalculatedPlan {
  const draft = generated();
  draft.stages['3']!.feasible = false;
  draft.stages['3']!.reason = 'Needs more iron.';
  draft.stages['3']!.additionalHeadroomMW = 120;
  return draft;
}
const verdict = (worthIt: boolean): FuelVerdict => ({
  unfueledFeasible: true,
  buildings: 120,
  buildingsUnfueled: 100,
  requiredMW: 5000,
  requiredMWUnfueled: 4500,
  availableMW: 6000,
  availableMWUnfueled: 5000,
  hours: 10,
  hoursUnfueled: 10,
  matrixRate: 5,
  worthIt,
});

// The tone each notice was drawn in, by a phrase of its text.
function tones(): [tone: string, text: string][] {
  assert.deepEqual(untonedNotices(), []);
  return $$('.notice').map(notice => [
    TONES.find(t => notice.classList.contains(t))!,
    (notice.textContent || '').replace(/\s+/g, ' ').trim(),
  ]);
}
const toneOf = (all: [string, string][], phrase: RegExp) => {
  const hit = all.find(([, text]) => phrase.test(text));
  assert.ok(hit, `a notice says ${phrase}`);
  return hit[0];
};

beforeEach(() => page());

const PAGES: View[] = ['plan', 'factories', 'logistics', 'storage', 'resources', 'backup'];

// open() opens a profile migrated from the handbook (#387), with its plan guide.
test('a profile migrated from the handbook draws each notice in its tone', () => {
  const all: [string, string][] = [];
  for (const view of PAGES) {
    page();
    open();
    go(view);
    render();
    all.push(...tones());
  }
  for (const floor of ['upper', 'workshop']) {
    page();
    open();
    setFloor(floor);
    go('storage');
    render();
    all.push(...tones());
  }
  setFloor('ground');
  assert.equal(toneOf(all, /transcribed from the original plan, not solved/), 'warn');
  assert.equal(toneOf(all, /Whole-machine production/), 'info');
  assert.equal(toneOf(all, /until the production lines are in factories/), 'info');
});

test('a calculated profile draws its draft and headroom as warnings, guidance as info', () => {
  const all: [string, string][] = [];
  for (const view of PAGES) {
    page();
    open({ calculated: draftPlan() });
    go(view);
    render();
    all.push(...tones());
  }
  page();
  const whole = generated();
  whole.settings.wholeMachines = true;
  open({ calculated: whole });
  go('factories');
  render();
  all.push(...tones());
  page();
  open({ calculated: generated(), phase: 'post' });
  go('plan');
  render();
  all.push(...tones());
  // Phase 1 runs on biomass, so the power notice asks for more there (#1064: from Phase 2 on the
  // plan's generators cover its need).
  page();
  const early = generated();
  early.settings.phase = '1';
  open({ calculated: early, phase: '1' });
  go('plan');
  render();
  all.push(...tones());
  assert.equal(toneOf(all, /Planning draft/), 'warn', 'infeasible draft');
  assert.equal(toneOf(all, /Whole-machine production:/), 'info');
  assert.equal(toneOf(all, /Retain these Phase 5 capacities/), 'info', 'phase guidance');
  assert.equal(toneOf(all, /This phase needs another [\d.,]+ \w+ of power\./), 'warn');
  assert.equal(toneOf(all, /Prefer extra production over underclocking/), 'info', 'round-up hint');
  assert.equal(toneOf(all, /Optional storage template/), 'info');
  const orange = all.filter(([tone]) => tone === 'warn').map(([, text]) => text);
  assert.ok(
    orange.every(t => /Planning draft|of power\./.test(t)),
    'only the warnings are orange: ' + orange.join(' | '),
  );
});

test('the wizard draws its notices in their tones, the fuel verdict by its answer', () => {
  const all: [string, string][] = [];
  for (const worth of [true, false])
    for (let step = 1; step <= 5; step++) {
      page();
      open({ workspace: { catalog: catalog() } });
      HTMLFormElement.prototype.reportValidity = () => true;
      const preview = draftPlan();
      preview.settings.augmenters = 2;
      preview.stages['5']!.fuelVerdict = verdict(worth);
      setWizard({
        step,
        saveId: null,
        saveName: 'World',
        name: '',
        settings: structuredClone(generated().settings),
        preview: step === 5 ? preview : null,
        carryFrom: null,
        carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
        mode: 'advanced',
        guidedStep: 1,
        guidedAsk: null,
        tutorial: 'doing',
      } as WizardDraft);
      go('wizard');
      render();
      all.push(...tones());
    }
  assert.equal(toneOf(all, /pays off\./), 'info');
  assert.equal(toneOf(all, /costs more than it returns/), 'warn');
  assert.equal(toneOf(all, /^Phase 3:/), 'warn', 'an infeasible phase on Review');
  assert.equal(toneOf(all, /SAM conversion controls/), 'info');
});
