// A calculated plan's optional guide (#393, #466): the narrative a migrated handbook profile
// keeps. A full-save export keeps it through validateTransfer, checked for shape, with only https
// source links; a malformed one is refused before anything is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransfer } from '../public/transfer.ts';
import { saveExport } from './types/fixtures.ts';
import type { PlanGuide, SaveExport } from '../public/types/index.ts';

const guide: PlanGuide = {
  phases: {
    '3': [{ id: 'phase-3-survey', title: 'Survey the iron site', body: 'Walk it first.' }],
    post: [{ id: 'phase-post-storage-first', title: 'Storage first', body: 'Then the rest.' }],
  },
  storageTasks: [{ id: 'storage-filter-moves', title: 'Move the filters', body: 'G08 → H02.' }],
  completion: [],
  power: {
    checks: [{ id: 'power-rocket-1', label: 'Rocket-fuel block 1: +72 GW' }],
    blocks: [{ title: 'One 72 GW rocket-fuel block', body: '10 refineries → 8 blenders.' }],
  },
  factories: { 'iron-ingot': { note: 'Next to the ore.', page: 12, local: true } },
  sources: [
    { title: 'Wiki', url: 'https://satisfactory.wiki.gg/' },
    { title: 'Plain', url: 'http://example.com/' },
    { title: 'Script', url: 'javascript:alert(1)' },
  ],
};

const withGuide = (g: unknown): SaveExport => {
  const x = structuredClone(saveExport);
  (x.saves[0]!.profiles[0]!.plan as unknown as { guide: unknown }).guide = g;
  return x;
};

test('an export keeps a plan guide, with only its https sources', () => {
  const plan = validateTransfer(withGuide(structuredClone(guide))).saves[0]!.profiles[0]!.plan!;
  assert.deepEqual(plan.guide, {
    ...guide,
    sources: [{ title: 'Wiki', url: 'https://satisfactory.wiki.gg/' }],
  });
});

test('a plan without a guide imports without one', () => {
  const plan = validateTransfer(structuredClone(saveExport)).saves[0]!.profiles[0]!.plan!;
  assert.equal('guide' in plan, false);
});

test('a malformed plan guide is refused', () => {
  for (const bad of [
    null,
    [],
    { phases: [] },
    { phases: { '3': [{ id: 'phase-3-survey', title: 'No body' }] } },
    { phases: { '3': 'steps' } },
    { phases: {}, storageTasks: [{ id: 1, title: 't', body: 'b' }] },
    { phases: {}, power: { checks: [{ id: 'power-x' }], blocks: [] } },
    { phases: {}, factories: { a: 'note' } },
    { phases: {}, sources: [{ title: 'No url' }] },
    // A step id is a saved check key (#471): the key rule, and unique across the guide.
    { phases: { '3': [{ id: 'phase 3 survey', title: 't', body: 'b' }] } },
    { phases: { '3': [{ id: 'x'.repeat(161), title: 't', body: 'b' }] } },
    { phases: { '3': [{ id: '__proto__', title: 't', body: 'b' }] } },
    {
      phases: {
        '3': [
          { id: 'dup', title: 't', body: 'b' },
          { id: 'dup', title: 't', body: 'b' },
        ],
      },
    },
    {
      phases: { '3': [{ id: 'dup', title: 't', body: 'b' }] },
      storageTasks: [{ id: 'dup', title: 't', body: 'b' }],
    },
    {
      phases: { post: [{ id: 'power-x', title: 't', body: 'b' }] },
      power: { checks: [{ id: 'power-x', label: 'l' }], blocks: [] },
    },
    { phases: {}, power: { checks: [{ id: 'power x', label: 'l' }], blocks: [] } },
    // The parts later pages render are typed too.
    { phases: {}, completion: [{ id: 'c', name: 'n', recipe: 'r', machine: 'm', output: '1' }] },
    { phases: {}, factories: { 'iron-ingot': { site: 'moon' } } },
    { phases: {}, factories: { 'iron-ingot': { page: 'twelve' } } },
  ])
    assert.throws(
      () => validateTransfer(withGuide(bad)),
      /Invalid plan guide\./,
      JSON.stringify(bad),
    );
});
