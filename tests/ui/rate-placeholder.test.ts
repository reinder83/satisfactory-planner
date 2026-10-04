// The rate field beside each group on a factory card in edit-groups mode (AssignEditor.vue, #958):
// its placeholder says what an empty field means, and "all / remainder" was cut off ("all /
// remainde") in Chrome, which keeps room for the number spinner inside a type="number" field.
// Layout is not measurable in happy-dom, so this checks the placeholder the page draws against the
// width the rules in public/style.css give the field, and that the page's other words for an empty
// field agree with it. The fit itself was measured in Chrome at 1440, 1100 and 390 px.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, go, migratedRow, open, page } from './setup.ts';

const css = fs.readFileSync('public/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The rules outside any @media block.
const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

function rule(body: string, selector: string) {
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (
      m[1]!
        .split(',')
        .map(s => s.trim().replace(/\s+/g, ' '))
        .includes(selector)
    )
      return m[2]!;
  return undefined;
}
const decl = (body: string | undefined, prop: string) =>
  body?.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1]!.trim();
const px = (value: string | undefined, what: string) => {
  const match = value?.match(/^(\d+(?:\.\d+)?)px$/);
  assert.ok(match, `${what} is set in px (got ${value})`);
  return Number(match[1]);
};

// What Chrome keeps for the spinner of a type="number" field: measured on the Pages build, the
// placeholder's box was 97px in a field whose content box is 112px.
const SPINNER = 15;
// IBM Plex Mono, the page's font, advances every character by 600/1000 of the font size.
const ADVANCE = 0.6;

// The room the rate field's placeholder has, from the rules in public/style.css.
function placeholderRoom() {
  assert.match(decl(rule(css, ':root'), 'font-family')!, /^'IBM Plex Mono'/);
  const columns = decl(rule(base, '.assign-row'), 'grid-template-columns');
  assert.ok(columns, '.assign-row sets its columns');
  const tracks = columns.match(/minmax\([^)]*\)|\S+/g)!;
  assert.equal(tracks.length, 3, 'group name, rate field, ✕');
  const width = px(tracks[1], 'the rate column');
  const input = rule(base, '.assign-row input');
  const padding = decl(input, 'padding')!.split(/\s+/);
  const sides = px(padding[1] ?? padding[0], 'the field’s side padding') * 2;
  const border = px(decl(input, 'border')!.split(/\s+/)[0], 'the field’s border') * 2;
  assert.equal(
    decl(input, 'appearance'),
    undefined,
    'the spinner is kept, like every number field',
  );
  return {
    room: width - sides - border - SPINNER,
    charWidth: ADVANCE * px(decl(input, 'font-size'), 'the field’s font size'),
  };
}

beforeEach(() => page());

async function editGroups() {
  const wire = migratedRow('wire');
  open({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'Cable factory' },
          { id: 'fg-plates1', name: 'Stitched plates' },
        ],
        assignments: {
          [wire]: [
            { group: 'fg-cable01', rate: 300 },
            { group: 'fg-plates1', rate: null },
          ],
        },
      },
    },
  });
  go('factories');
  setFactoryEditing(true);
  render();
  await nextTick();
  return wire;
}

test('the rate field’s whole placeholder fits beside the number spinner (#958)', async () => {
  await editGroups();
  const fields = $$<HTMLInputElement>('[data-assign-rate]');
  assert.ok(fields.length >= 2, 'a rate field per membership');
  const { room, charWidth } = placeholderRoom();
  for (const field of fields) {
    const text = field.getAttribute('placeholder')!;
    assert.ok(
      text.length * charWidth <= room,
      `"${text}" takes ${(text.length * charWidth).toFixed(1)}px; the field has ${room}px beside its spinner`,
    );
    // Both cases an empty field stands for: the only group, or after the groups with a rate.
    assert.equal(text, 'all / rest');
  }
});

test('the page’s other words for an empty rate say what the placeholder says (#958)', async () => {
  const wire = await editGroups();
  // The field's name says what it holds; the placeholder says what empty means.
  for (const field of $$<HTMLInputElement>('[data-assign-rate]')) {
    assert.match(field.getAttribute('aria-label')!, /^Production per minute in /);
    assert.doesNotMatch(field.getAttribute('aria-label')!, /remainder|rest\b|all\b/i);
  }
  const description = $('.edit-panel p')!.textContent!.replace(/\s+/g, ' ');
  assert.match(description, /Leave the rate empty for the whole output or the rest\./);
  assert.doesNotMatch(description, /remainder/);
  // A rate that cannot be saved is explained in the same words.
  const rate = $<HTMLInputElement>(`[data-assign-rate="${wire}"][data-group="fg-cable01"]`)!;
  rate.value = '-4';
  rate.dispatchEvent(new Event('change'));
  await nextTick();
  assert.equal(
    $('#toast')!.textContent!.trim(),
    'Enter a rate above 0, or leave the field empty for the whole output or the rest.',
  );
});
