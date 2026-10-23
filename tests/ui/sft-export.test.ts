// "Export to Satisfactory Tools" (#1209) on each factory's heading on the Factories page, on the
// planner's default Phase 3 plan with the default factory groups: a real button beside "Flow
// graph ↗", named after its factory, that writes a .sft file of the factory's tab (sftTab of the
// flow the flow page reads) and says how to open it; nothing is saved. Hostile factory names stay
// text, in the page and in the file.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import { setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, evil, generated, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const GROUP = 'fg-iron01';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
async function showFactories(factoryGroups = groups) {
  page();
  setQuery('');
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups } });
  go('factories');
  render();
  await settle();
}
const button = (id = GROUP) => $<HTMLButtonElement>(`#main [data-group-sft="${id}"]`)!;
const toastText = () => $('#toast')!.textContent || '';

// The .sft file the button offers, decoded as Satisfactory Tools reads it, and its name.
async function exported(id = GROUP) {
  let saved: Blob | undefined;
  let name = '';
  URL.createObjectURL = (blob: Blob | MediaSource) => ((saved = blob as Blob), 'blob:sft');
  URL.revokeObjectURL = () => {};
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    name = this.download;
  });
  try {
    button(id).click();
    await vi.waitFor(() => assert.ok(saved && name));
  } finally {
    click.mockRestore();
  }
  // Set by the stub above, which the wait checked.
  const text = await saved!.text();
  const data = text.split('\n').find(line => line && !line.startsWith('#')) ?? '';
  assert.ok(data.startsWith('0'));
  const file = JSON.parse(inflateSync(Buffer.from(data.slice(1), 'base64')).toString('utf8'));
  return { text, file, name };
}

beforeEach(() => showFactories());

test('every factory with a production line has "Export to Satisfactory Tools" after its flow graph', () => {
  const sections = $$('#main .user-group');
  assert.ok(sections.length > 2, 'the default groups are drawn');
  for (const section of sections) {
    const id = section.id.replace(/^section-/, '');
    const sft = section.querySelector<HTMLButtonElement>(`[data-group-sft="${id}"]`);
    assert.ok(sft, id + ' has the export button');
    assert.equal(sft.localName, 'button');
    assert.equal(sft.type, 'button');
    assert.equal(sft.textContent?.trim(), 'Export to Satisfactory Tools');
    const name = section.querySelector('h2')!.textContent!;
    assert.equal(sft.getAttribute('aria-label'), `Export ${name} to Satisfactory Tools`);
    assert.equal(sft.previousElementSibling?.getAttribute('data-group-graph'), id);
  }
});

test('the button writes the factory’s tab as a .sft file and says how to import it', async () => {
  const checks = structuredClone(state.checks);
  const { text, file, name } = await exported();
  const group = groups.groups.find(entry => entry.id === GROUP)!;
  assert.match(text, /^# Satisfactory Tools production plan/);
  assert.equal(file.type, 'tabs');
  assert.equal(file.tabs.length, 1);
  const [tab] = file.tabs;
  assert.equal(tab.metadata.name, `${group.name}, Phase 3`);
  assert.ok(tab.request.production.length > 0, 'it asks for what the factory makes');
  for (const entry of [...tab.request.production, ...tab.request.input])
    assert.match(entry.item, /^Desc_\w+_C$/);
  assert.ok(tab.request.resourceMax.Desc_OreIron_C > 0, 'the phase’s budgets');
  assert.match(name, /^[a-z0-9-]+-phase-3\.sft$/);
  assert.equal(
    toastText(),
    `Saved ${name}. On satisfactorytools.com, open the Production planner and choose Import.`,
  );
  // Nothing is saved, and the button is ready again.
  assert.equal(button().getAttribute('aria-disabled'), null);
  assert.deepEqual(state.checks, checks);
});

test('a hostile factory name stays text on the button and in the file', async () => {
  const hostile = structuredClone(groups);
  const target = hostile.groups.find(entry => entry.id === GROUP)!;
  target.name = evil;
  await showFactories(hostile);
  const id = GROUP;
  assert.equal(button(id).getAttribute('aria-label'), `Export ${evil} to Satisfactory Tools`);
  assert.equal($('#main x-evil'), null);
  const { file, name } = await exported(id);
  assert.equal(file.tabs[0].metadata.name, `${evil}, Phase 3`);
  assert.match(name, /^[a-z0-9-]+\.sft$/);
});
