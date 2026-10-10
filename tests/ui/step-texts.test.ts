// The build plan's steps, word for word (#1060): the speed-ups of the step texts (one machine
// setup per line, one number formatter per option set, the steps worked out once per redraw)
// must leave every title, body and flag exactly as they were. The steps of each phase of several
// stored plans, with ticks that bring in the handover's sentences, are compared with the steps
// recorded before those changes (tests/fixtures/step-texts-2026-10-10.json: each step's id with a
// hash of its title, body and flags, so a failure names the step that changed). Run with
// RECORD_STEP_TEXTS=1 to record them again, only on code whose texts are known to be right.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'vitest';
import { planTasks, type Step } from '../../public/app/tasks.ts';
import { migratedPlan, open } from './setup.ts';
import type {
  FactoryGroups,
  Phase,
  ProgressState,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const FIXTURE = 'tests/fixtures/step-texts-2026-10-10.json';
const read = (name: string) => JSON.parse(fs.readFileSync('tests/fixtures/' + name, 'utf8'));
const PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];

// Every other production line of every phase marked running, so a phase's lines that the phase
// before ran open with what already runs (#1069).
function someTicks(plan: StoredCalculatedPlan): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  for (const [stage, snapshot] of Object.entries(plan.stages))
    (snapshot.rows || []).forEach((row, i) => {
      if (i % 2 === 0) checks['calc-' + stage + '-' + row.id] = true;
    });
  return checks;
}

// `plan` with its first three lines of each phase marked amplified, with one, two and four
// somersloops a machine (synthetic, for the step's somersloop sentence).
function amplified(plan: StoredCalculatedPlan): StoredCalculatedPlan {
  for (const snapshot of Object.values(plan.stages))
    (snapshot.rows || []).slice(0, 3).forEach((row, i) => {
      const slots = [1, 2, 4][i]!;
      Object.assign(row, { amplified: true, slots, sloops: slots * row.machines });
    });
  return plan;
}

const sunk = read('on-site-sunk-central-2026-10-05.json');
const cases: [string, StoredCalculatedPlan, Partial<ProgressState>][] = [
  ['first release plan', read('calculated-plan-2026-09-12.json'), {}],
  ['fuel plan', read('fuel-plan-2026-10-05.json'), {}],
  ['custom alternates', read('mam-milestone-alternates-2026-10-04.json').plan, {}],
  ['plan before #1065', read('plan-before-1065.json').plan, {}],
  [
    'lines made on site',
    sunk.plan,
    {
      factoryGroups: {
        groups: sunk.groups.groups,
        assignments: sunk.groups.assignments,
        local: sunk.groups.local,
      } as FactoryGroups,
    },
  ],
  ['plan guide (migrated handbook)', migratedPlan(), {}],
  ['amplified lines', amplified(read('fuel-plan-2026-10-05.json')), {}],
];

// A step's title, body and flags (optional, satisfied), as a short hash.
const fingerprint = (step: Step) =>
  createHash('sha256')
    .update(JSON.stringify([step.title, step.body, step.optional, step.satisfied]))
    .digest('base64url')
    .slice(0, 16);

// Each case's steps per phase, as [id, fingerprint], without and with ticks.
function stepTexts() {
  const texts: Record<string, Record<string, unknown>> = {};
  for (const [name, plan, extra] of cases)
    for (const [label, checks] of [
      ['', {}],
      [' ticked', someTicks(plan)],
    ] as const) {
      const phases: Record<string, unknown> = {};
      for (const phase of PHASES) {
        open({ calculated: structuredClone(plan), phase, state: { ...extra, checks } });
        phases[phase] = planTasks(phase).map(step => [step.id, fingerprint(step)]);
      }
      texts[name + label] = phases;
    }
  return texts;
}

// The recording as JSON with one step per line, so a re-recording's diff names the steps.
const oneStepPerLine = (texts: object) =>
  JSON.stringify(texts, null, 1).replace(/\[\n\s+("[^"]*"),\n\s+("[^"]*")\n\s+\]/g, '[$1, $2]') +
  '\n';

test('every step of every phase reads exactly as recorded before #1060', () => {
  const texts = stepTexts();
  if (process.env.RECORD_STEP_TEXTS) fs.writeFileSync(FIXTURE, oneStepPerLine(texts));
  const recorded = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(Object.keys(texts), Object.keys(recorded));
  for (const name of Object.keys(recorded))
    for (const phase of PHASES)
      assert.deepEqual(
        JSON.parse(JSON.stringify(texts[name]![phase])),
        recorded[name][phase],
        name + ', phase ' + phase,
      );
});
