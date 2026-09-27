// The shared #detail dialog is named by its heading (#321), as #confirm is by #confirm-title:
// every kind of dialog shown in it, and the one a link inside it puts in its place.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'vitest';
import {
  openCalculatedFactory,
  openFactory,
  openGroupChain,
} from '../../public/app/factory-detail.ts';
import { calcStage, setWorkspace, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { closeDetail } from '../../public/app/ui/actions.ts';
import { openSlot } from '../../public/app/views/storage.ts';
import { openAltRecipe } from '../../public/app/wizard/recipes.ts';
import { $, answerConfirms, catalog, generated, go, open, page } from './setup.ts';

// The attributes index.html gives <dialog id="detail">, which page() leaves out: this file
// checks the page the app ships, not a copy of it. Vitest runs from the repository root.
const shipped = readFileSync('public/index.html', 'utf8');
const detailTag = /<dialog\s+id="detail"([^>]*)>/.exec(shipped);
const detailAttrs = [...(detailTag?.[1] ?? '').matchAll(/([\w-]+)="([^"]*)"/g)];

const plan = generated();

beforeEach(() => {
  page();
  const d = $<HTMLDialogElement>('#detail')!;
  for (const [, name, value] of detailAttrs) d.setAttribute(name!, value!);
  answerConfirms(true);
});

// The dialog's accessible name from aria-labelledby: the text of the elements it points at.
const accessibleName = () => {
  const ids = ($('#detail')!.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return ids
    .map(id => document.getElementById(id))
    .map(el => {
      assert.ok(el, 'aria-labelledby points at an element on the page');
      assert.ok($('#detail')!.contains(el), 'inside the dialog');
      return el.textContent!.trim();
    })
    .join(' ');
};
const namedBy = (title: string, what: string) => {
  assert.ok($<HTMLDialogElement>('#detail')!.open, what + ' is open');
  assert.equal($('#detail h2')!.textContent, title, what + ' shows its title');
  assert.equal(accessibleName(), title, what + ' is named by its title');
};

test('#detail is named by its heading, as #confirm is (#321)', () => {
  assert.equal($('#detail')!.getAttribute('aria-labelledby'), 'detail-title');
});

test('a handbook factory dialog is named by its title, and the one a link puts in its place by its own (#321)', async () => {
  open();
  go('factories');
  render();
  openFactory('wire');
  namedBy('Wire', 'the Wire dialog');
  $<HTMLButtonElement>('#detail .rail-link[data-factory="cable"]')!.click();
  namedBy('Cable', 'the Cable dialog that replaced it');
  void closeDetail();
  await new Promise(r => setTimeout(r, 20));
  openFactory('wire');
  namedBy('Wire', 'the Wire dialog opened again');
});

test('a calculated factory dialog is named by its title, also after a link replaces it (#321)', () => {
  open({ calculated: plan });
  go('factories');
  render();
  const x = calcStage()!;
  const r = x.rows!.find(r =>
    Object.keys(r.outputs).some(n => x.rows!.some(o => o.id !== r.id && o.inputs[n])),
  )!;
  openCalculatedFactory(r.id);
  namedBy(r.name, 'the calculated factory dialog');
  const link = $<HTMLElement>('#detail .dialog-body [data-calc-factory]')!;
  const next = x.rows!.find(o => o.id === link.dataset.calcFactory)!;
  link.click();
  namedBy(next.name, 'the calculated factory dialog that replaced it');
});

test('a group build order is named by the group, and a factory opened from it by its own (#321)', () => {
  const x = plan.stages['3'];
  const consumer = x.rows!.find(r =>
    x.rows!.some(o => o.id !== r.id && Object.keys(o.outputs || {}).some(n => r.inputs?.[n])),
  )!;
  const supplier = x.rows!.find(
    o => o.id !== consumer.id && Object.keys(o.outputs || {}).some(n => consumer.inputs[n]),
  )!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-test01', name: 'Chain test' }],
        assignments: {
          [consumer.id]: [{ group: 'fg-test01', rate: null }],
          [supplier.id]: [{ group: 'fg-test01', rate: null }],
        },
      },
    },
  });
  go('factories');
  render();
  openGroupChain('fg-test01');
  namedBy('Chain test', 'the build order');
  $<HTMLButtonElement>('#detail .chain-title [data-calc-factory]')!.click();
  namedBy(supplier.name, 'the factory dialog that replaced it');
});

test('a storage container dialog is named by its item (#321)', () => {
  open();
  go('storage');
  render();
  openSlot('A01');
  const title = $('#detail h2')!.textContent!;
  assert.ok(title.length > 0);
  namedBy(title, 'the container dialog');
});

test('an alternate-recipe dialog is named by the recipe, also in place of another (#321)', () => {
  open();
  setWorkspace({ ...workspace, catalog: catalog() });
  const [a, b] = workspace.catalog.alternates!;
  openAltRecipe(a!.id);
  namedBy(a!.name, 'the alternate-recipe dialog');
  openAltRecipe(b!.id);
  namedBy(b!.name, 'the alternate-recipe dialog that replaced it');
});
